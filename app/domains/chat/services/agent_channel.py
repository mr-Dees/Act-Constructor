"""Сервис канала к внешнему агенту через bus-таблицу chat_agent_messages_bus.

Поток:
  AW → submit() → INSERT вопрос (role='user', status='pending')
                 + create_streaming draft (status='streaming', agent_ref=uid)
  Агент → INSERT ответ + reply_to на вопросе + status='complete'
  AW → try_finalize() → читает вопрос; если reply_to есть → финализирует draft.
"""

import logging
import uuid

import asyncpg

from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.repositories.agent_message_repository import AgentMessageRepository
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.services.button_translator import translate_buttons
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.agent_channel")

_TRIM_MARKER = " …[обрезано]"
_TRIM_MARKER_BYTES = len(_TRIM_MARKER.encode("utf-8"))


# ── Pure-функции ─────────────────────────────────────────────────────────────


def _trim_text_if_oversized(*, text: str, max_size: int, uid: str, block_type: str) -> str:
    """Обрезает ``text`` до ``max_size`` UTF-8 байт + маркер «…[обрезано]».

    UTF-8-safe: режем по байтам, затем откатываемся до начала предыдущего
    code-point (0b10xxxxxx — continuation byte; 0b11xxxxxx — lead без хвоста).
    Если ``text`` помещается — быстрый путь без encode.
    """
    if not text:
        return text
    encoded = text.encode("utf-8")
    if len(encoded) <= max_size:
        return text
    original_size = len(encoded)
    cut_at = max_size - _TRIM_MARKER_BYTES
    if cut_at <= 0:
        return _TRIM_MARKER.strip()
    truncated_bytes = encoded[:cut_at]
    # Откат с continuation bytes (10xxxxxx).
    while truncated_bytes and (truncated_bytes[-1] & 0xC0) == 0x80:
        truncated_bytes = truncated_bytes[:-1]
    # Откат с lead byte без хвоста (11xxxxxx).
    if truncated_bytes and (truncated_bytes[-1] & 0xC0) == 0xC0:
        truncated_bytes = truncated_bytes[:-1]
    truncated_text = truncated_bytes.decode("utf-8", errors="ignore")
    result = truncated_text + _TRIM_MARKER
    logger.warning(
        "agent_channel: блок обрезан с %d до %d байт, uid=%s, type=%s",
        original_size,
        len(result.encode("utf-8")),
        uid,
        block_type,
    )
    return result


def _normalize_button(btn: dict, idx: int) -> dict:
    """Нормализует одну кнопку из ответа агента с дефолтами."""
    return {
        "action_id": btn.get("action_id", f"btn_{idx}"),
        "label": btn.get("label", ""),
        "params": btn.get("params") or {},
    }


def map_answer_to_blocks(row: dict, max_block_text_size: int = 262144) -> list[dict]:
    """Маппит строку-ответ chat_agent_messages_bus в блоки чата.

    Порядок: reasoning (metadata.thinking) → text (content) → buttons → media.
    block_id кнопок и reasoning: ``f"{row['id']}:btn:0"`` / ``f"{row['id']}:reasoning:0"``.
    Тексты обрезаются через _trim_text_if_oversized.
    """
    row_id = row.get("id", "unknown")
    blocks: list[dict] = []

    # 1. reasoning из metadata.thinking
    metadata = row.get("metadata") or {}
    if isinstance(metadata, dict):
        thinking = metadata.get("thinking")
        if thinking and isinstance(thinking, str) and thinking.strip():
            trimmed = _trim_text_if_oversized(
                text=thinking.strip(),
                max_size=max_block_text_size,
                uid=row_id,
                block_type="reasoning",
            )
            blocks.append({
                "type": "reasoning",
                "content": trimmed,
                "block_id": f"{row_id}:reasoning:0",
            })

    # 2. text из content
    content = row.get("content")
    if content and isinstance(content, str) and content.strip():
        trimmed = _trim_text_if_oversized(
            text=content.strip(),
            max_size=max_block_text_size,
            uid=row_id,
            block_type="text",
        )
        blocks.append({"type": "text", "content": trimmed})

    # 3. buttons
    buttons = row.get("buttons")
    if buttons and isinstance(buttons, list) and len(buttons) > 0:
        normalized = [_normalize_button(b, i) for i, b in enumerate(buttons)]
        blocks.append({
            "type": "buttons",
            "buttons": normalized,
            "block_id": f"{row_id}:btn:0",
        })

    # 4. media
    media = row.get("media")
    if media is not None:
        # Одиночный объект → оборачиваем в список.
        if isinstance(media, dict):
            media = [media]
        if isinstance(media, list):
            for item in media:
                if not isinstance(item, dict):
                    continue
                mime = item.get("mime_type", "")
                file_id = item.get("file_id", item.get("url", ""))
                filename = item.get("filename", item.get("name", ""))
                if mime.startswith("image/"):
                    blocks.append({
                        "type": "image",
                        "file_id": file_id,
                        "alt": filename,
                    })
                else:
                    blocks.append({
                        "type": "file",
                        "file_id": file_id,
                        "filename": filename,
                        "mime_type": mime,
                        "file_size": int(item.get("file_size", 0)),
                    })

    return blocks


def build_timeout_error_block() -> dict:
    """Возвращает error-блок таймаута агента."""
    return {
        "type": "error",
        "code": "agent_timeout",
        "message": "Внешний агент не ответил вовремя. Попробуйте позже.",
    }


# ── Сервис ───────────────────────────────────────────────────────────────────


class AgentChannelService:
    """Сервис канала к внешнему агенту через bus-таблицу chat_agent_messages_bus.

    Принимает ``conn`` (asyncpg.Connection) и ``settings`` (ChatDomainSettings).
    Паттерн получения settings идентичен MessageService / ConversationService:
    вызывающий код инжектирует настройки снаружи.
    """

    def __init__(self, conn: asyncpg.Connection, settings: ChatDomainSettings):
        self._conn = conn
        self._settings = settings

    def _agent_repo(self) -> AgentMessageRepository:
        return AgentMessageRepository(
            self._conn,
            self._settings.agent_channel.table_name,
        )

    def _message_repo(self) -> MessageRepository:
        return MessageRepository(self._conn)

    async def submit(
        self,
        *,
        conversation_id: str,
        user_id: str,
        assistant_message_id: str,
        text: str,
        mode: str,
        kb: str = "oarb",
        media: list | None = None,
    ) -> str:
        """Кладёт вопрос в chat_agent_messages_bus и создаёт draft-сообщение в chat_messages.

        Возвращает ``question_uid`` — id строки-вопроса в bus-таблице.
        Вызывающий может сразу передать его поллеру без дополнительного SELECT;
        draft в chat_messages хранит тот же uid в поле ``agent_ref``.
        """
        # Мягкий лимит: count-then-insert не атомарен, два конкурентных запроса
        # могут оба пройти проверку на границе. Это защита от злоупотребления,
        # а не строгий инвариант — небольшое превышение допустимо.
        limit = self._settings.max_parallel_streams_per_user
        active = await self._agent_repo().count_active_for_user(user_id)
        if active >= limit:
            raise ChatLimitError(
                f"Достигнут лимит одновременных запросов к агенту ({limit}). "
                "Дождитесь ответа на предыдущие."
            )

        question_uid = str(uuid.uuid4())

        # Оба INSERT'а — в одной транзакции: вопрос в шине без draft'а (или
        # наоборот) оставил бы осиротевшую строку, которая вечно входит в
        # count_active_for_user и съедает слот лимита параллельных запросов.
        async with self._conn.transaction():
            await self._agent_repo().insert_question(
                id=question_uid,
                chat_id=conversation_id,
                user_id=user_id,
                content=text,
                metadata={"mode": mode, "kb": kb},
                media=media,
            )
            await self._message_repo().create_streaming(
                message_id=assistant_message_id,
                conversation_id=conversation_id,
                agent_ref=question_uid,
            )
        return question_uid

    async def mark_timeout(
        self,
        *,
        assistant_message_id: str,
        question_uid: str,
    ) -> None:
        """Помечает draft как failed (error-блок таймаута) и ставит вопросу status='timeout'."""
        # Best-effort без общей транзакции: если set_status упадёт после
        # mark_failed, строка в chat_agent_messages_bus останется в pending — побочных
        # эффектов нет, reconcile её не подхватит (chat_message уже failed, а
        # get_streaming_drafts отбирает только status='streaming').
        await self._message_repo().mark_failed(
            message_id=assistant_message_id,
            error_block=build_timeout_error_block(),
        )
        await self._agent_repo().set_status(
            uid=question_uid,
            status="timeout",
        )
        logger.info(
            "agent_channel: таймаут — message_id=%s, question_uid=%s",
            assistant_message_id,
            question_uid,
        )

    async def _emit_answer_notification(
        self,
        *,
        question: dict | None,
        title: str,
        severity: str,
    ) -> None:
        """Эмитит персистентное уведомление о готовности/ошибке ответа агента.

        Best-effort: вся эмиссия обёрнута в try/except — сбой или отсутствие
        домена notifications НЕ должны ломать финализацию ответа (она уже
        успешно записана в БД к моменту вызова). Фабрика разрешается мягко
        через ``has_factory``/``get_factory`` (импорт локальный, чтобы не
        плодить import-циклы и чтобы тесты могли патчить domain_registry).

        Получатель — автор вопроса (``question.user_id``). Если строки-вопроса
        нет или у неё нет user_id — уведомление не эмитим (broadcast здесь не
        нужен, а адресовать ответ некому).

        Ссылка: чат — это popup без собственного URL, а в метаданных вопроса
        (``{"mode", "kb"}``) надёжного ``act_id`` нет. Поэтому ``link=None``
        (переход из уведомления не предусмотрен — допустимо по спеке). Не
        выдумываем несуществующий URL чата.
        """
        if not question:
            return
        recipient_user_id = question.get("user_id")
        if not recipient_user_id:
            return

        # Делегируем единому ядерному хелперу (резолв фабрики + мягкий
        # try/except). Локальный импорт — без жёсткой зависимости на
        # module-level и для патчинга реестра в тестах.
        from app.core.notifications_emit import push_notification

        await push_notification(
            source="chat",
            title=title,
            severity=severity,
            link=None,
            recipient_user_id=recipient_user_id,
        )

    async def try_finalize(
        self,
        *,
        assistant_message_id: str,
        question_uid: str,
    ) -> str:
        """Проверяет готовность ответа и финализирует draft при наличии.

        Читает строку-вопрос по ``question_uid``. Если ``reply_to`` не выставлен —
        возвращает ``'pending'``. Если агент проставил ``reply_to``:
        - читает строку-ответ (по reply_to как id);
        - если answer.status == 'error' → mark_failed(error-блок);
        - иначе → finalize(map_answer_to_blocks(answer)).
        Возвращает ``'done'`` после финализации, ``'pending'`` если ответа ещё нет.
        """
        agent_repo = self._agent_repo()
        message_repo = self._message_repo()

        question = await agent_repo.get_by_uid(question_uid)
        if not question:
            logger.warning(
                "try_finalize: вопрос %s не найден в bus-таблице", question_uid
            )
            return "pending"

        reply_to = question.get("reply_to")
        if not reply_to:
            return "pending"

        answer = await agent_repo.get_by_uid(reply_to)
        if not answer:
            logger.warning(
                "try_finalize: ответ %s (reply_to) не найден в bus-таблице", reply_to
            )
            return "pending"

        if answer.get("status") == "error":
            error_message = answer.get("content") or "Внешний агент вернул ошибку."
            error_block = {
                "type": "error",
                "code": "agent_error",
                "message": error_message,
            }
            failed = await message_repo.mark_failed(
                message_id=assistant_message_id,
                error_block=error_block,
            )
            if failed:
                # Уведомление об ошибке — ровно один раз, на тике, который
                # реально перевёл сообщение в терминал, и ДО set_status: при
                # сбое set_status поллер повторит try_finalize, но mark_failed
                # вернёт False — уведомление не задвоится и не потеряется.
                # best-effort (см. _emit_answer_notification).
                await self._emit_answer_notification(
                    question=question,
                    title="Ошибка ответа базы знаний",
                    severity="error",
                )
            # Закрываем вопрос: AW — source-of-truth освобождения слота лимита,
            # не полагаемся на то, что внешний агент проставит терминальный
            # status (он мог выставить только reply_to). Не best-effort: при
            # сбое set_status исключение поднимется в _tick, подписка останется
            # и поллер повторит try_finalize на следующем тике (mark_failed
            # идемпотентен — вернёт False на уже не-streaming сообщении).
            await agent_repo.set_status(uid=question_uid, status="error")
            return "done"

        # Транслируем кнопки (acts.open_act_page → open_url) перед маппингом в блоки.
        if answer.get("buttons"):
            answer["buttons"] = await translate_buttons(answer["buttons"])

        blocks = map_answer_to_blocks(
            answer,
            max_block_text_size=self._settings.agent_channel.max_block_text_size,
        )
        finalized = await message_repo.finalize(
            message_id=assistant_message_id,
            final_blocks=blocks,
        )
        if finalized:
            # Уведомление о готовности — ровно один раз, на тике, который
            # реально финализировал черновик, и ДО set_status: при сбое
            # set_status поллер повторит try_finalize, но finalize вернёт False
            # — уведомление не задвоится и не потеряется. best-effort
            # (см. _emit_answer_notification).
            await self._emit_answer_notification(
                question=question,
                title="Готов ответ базы знаний",
                severity="info",
            )
        # Закрываем вопрос в шине: освобождаем слот лимита независимо от того,
        # проставил ли внешний агент терминальный status (мог выставить только
        # reply_to). AW — source-of-truth. Вне общей транзакции: при сбое
        # set_status поллер повторит try_finalize на следующем тике (finalize
        # идемпотентен — вернёт False на уже complete-сообщении).
        await agent_repo.set_status(uid=question_uid, status="complete")
        return "done"
