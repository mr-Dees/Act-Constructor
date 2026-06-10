"""Сервис канала к внешнему агенту через bus-таблицу chat_agent_messages_bus.

Поток (подтверждённая спека владельца шины — стороны агента):
  AW → submit() → INSERT вопрос (role='user', status='pending')
                 + create_streaming draft (status='streaming', agent_ref=uid)
  Агент → claim вопроса (status='processing') → INSERT ответ (role='assistant',
          reply_to = id ВОПРОСА) → стримит reasoning-дельты в metadata.reasoning
          → пишет финальный content и терминальный status ('completed'/'failed')
  AW → try_finalize() → ищет ответ по reply_to = id вопроса; финализирует draft,
       когда статус ответа терминальный.

Словарь status владельца (CHECK на его таблице): pending | processing |
completed | failed; role: user | assistant | system. Записи статуса от AW —
best-effort: CheckViolation логируется и глотается, финализацию/таймаут это
не ломает (защита от смены словаря владельцем).
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg

from app.domains.chat.exceptions import AgentChannelUnavailableError, ChatLimitError
from app.domains.chat.repositories.agent_message_repository import AgentMessageRepository
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.services.button_translator import translate_buttons
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.agent_channel")

_TRIM_MARKER = " …[обрезано]"
_TRIM_MARKER_BYTES = len(_TRIM_MARKER.encode("utf-8"))

# Нетерминальные статусы строки шины: ответ с таким статусом ещё пишется
# агентом — финализировать рано. Словарь владельца: 'processing' (агент создаёт
# строку-ответ сразу при claim'е и стримит reasoning-дельты в metadata, пока не
# запишет финальный content); 'in_progress' — legacy-синоним для старых dev-строк.
# Любой другой статус при наличии строки-ответа считаем терминальным.
_BUS_PENDING_STATUSES = ("pending", "processing", "in_progress")

# Терминальные статусы ошибки: 'failed' — словарь владельца, 'error' — legacy.
_BUS_ERROR_STATUSES = ("failed", "error")


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

    Порядок: reasoning (metadata.reasoning, legacy metadata.thinking) →
    text (content) → buttons → media.
    block_id кнопок и reasoning: ``f"{row['id']}:btn:0"`` / ``f"{row['id']}:reasoning:0"``.
    Тексты обрезаются через _trim_text_if_oversized.
    """
    row_id = row.get("id", "unknown")
    blocks: list[dict] = []

    # 1. reasoning из metadata.reasoning (ключ по спеке владельца шины;
    #    'thinking' — legacy-fallback для старых строк и dev-имитаций)
    metadata = row.get("metadata") or {}
    if isinstance(metadata, dict):
        thinking = metadata.get("reasoning") or metadata.get("thinking")
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

    async def _set_status_safe(self, *, uid: str, status: str) -> None:
        """Best-effort запись статуса в чужую bus-таблицу.

        На таблице владельца есть CHECK по status; его полный список значений
        нам неизвестен и может меняться. CheckViolation — постоянная ошибка
        (ретрай бесполезен), глотаем с warning'ом: статус в шине — гигиена,
        source-of-truth отображения — chat_messages. Транзиентные ошибки БД
        пробрасываются — поллер повторит операцию на следующем тике.
        """
        try:
            await self._agent_repo().set_status(uid=uid, status=status)
        except asyncpg.exceptions.CheckViolationError:
            logger.warning(
                "agent_channel: CHECK владельца шины отклонил status=%r для uid=%s — пропускаем",
                status,
                uid,
            )

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
        # Отсечка по возрасту: вопрос старше answer_timeout_sec считаем мёртвым
        # и слот не занимает — терминальный статус на чужой таблице мог не
        # записаться (CHECK владельца), без отсечки слот утекал бы навсегда.
        limit = self._settings.max_parallel_streams_per_user
        cutoff = datetime.now(timezone.utc) - timedelta(
            seconds=self._settings.agent_channel.answer_timeout_sec
        )
        active = await self._agent_repo().count_active_for_user(
            user_id, created_after=cutoff
        )
        if active >= limit:
            raise ChatLimitError(
                f"Достигнут лимит одновременных запросов к агенту ({limit}). "
                "Дождитесь ответа на предыдущие."
            )

        question_uid = str(uuid.uuid4())

        # Оба INSERT'а — в одной транзакции: вопрос в шине без draft'а (или
        # наоборот) оставил бы осиротевшую строку, которая вечно входит в
        # count_active_for_user и съедает слот лимита параллельных запросов.
        try:
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
        except asyncpg.exceptions.CheckViolationError as exc:
            # CHECK владельца шины отклонил наш вопрос (например, после смены
            # словаря на его стороне). Имя его констрейнта на ПРОМе чужое —
            # глобальный обработчик CheckViolationError не найдёт маппинг в
            # CHECK_CONSTRAINT_MESSAGES, поэтому конвертируем в доменную ошибку
            # с понятным сообщением. Транзакция уже откатила draft.
            logger.error(
                "agent_channel: CHECK владельца шины отклонил вопрос uid=%s: %s",
                question_uid,
                exc,
            )
            raise AgentChannelUnavailableError(
                "Не удалось передать вопрос внешнему агенту. Попробуйте позже."
            ) from exc
        return question_uid

    async def mark_timeout(
        self,
        *,
        assistant_message_id: str,
        question_uid: str,
    ) -> None:
        """Помечает draft как failed (error-блок таймаута) и закрывает вопрос в шине."""
        # Закрываем вопрос статусом 'failed' — он есть в словаре CHECK'а
        # владельца ('timeout' там запрещён). Запись всё равно best-effort:
        # если CHECK отклонит, строка останется в pending — побочных эффектов
        # нет: reconcile её не подхватит (chat_message уже failed,
        # get_streaming_drafts отбирает только status='streaming'), а слот
        # лимита освобождает отсечка по возрасту в count_active_for_user.
        await self._message_repo().mark_failed(
            message_id=assistant_message_id,
            error_block=build_timeout_error_block(),
        )
        await self._set_status_safe(uid=question_uid, status="failed")
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

        Протокол владельца шины: агент вставляет строку-ответ с
        ``reply_to = id вопроса`` — ответ ищется обратным lookup'ом
        (``get_answer_for_question``); у строки-вопроса ``reply_to`` всегда NULL.
        - ответа нет или его статус нетерминальный → ``'pending'``;
        - answer.status == 'failed'/'error' → mark_failed(error-блок) → ``'done'``;
        - иначе → finalize(map_answer_to_blocks(answer)) → ``'done'``.
        """
        agent_repo = self._agent_repo()
        message_repo = self._message_repo()

        question = await agent_repo.get_by_uid(question_uid)
        if not question:
            logger.warning(
                "try_finalize: вопрос %s не найден в bus-таблице", question_uid
            )
            return "pending"

        answer = await agent_repo.get_answer_for_question(question_uid)
        if not answer:
            # Агент мог закрыть вопрос со status='failed' без строки-ответа.
            if question.get("status") in _BUS_ERROR_STATUSES:
                failed = await message_repo.mark_failed(
                    message_id=assistant_message_id,
                    error_block={
                        "type": "error",
                        "code": "agent_error",
                        "message": "Внешний агент вернул ошибку.",
                    },
                )
                if failed:
                    await self._emit_answer_notification(
                        question=question,
                        title="Ошибка ответа базы знаний",
                        severity="error",
                    )
                return "done"
            return "pending"

        # Агент мог вставить строку-ответ до завершения генерации — ждём
        # терминального статуса (любого, кроме явно нетерминальных).
        if answer.get("status") in _BUS_PENDING_STATUSES:
            return "pending"

        if answer.get("status") in _BUS_ERROR_STATUSES:
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
            # Закрываем вопрос ('failed' — словарь владельца): не полагаемся
            # на то, что внешний агент проставит терминальный status.
            # CheckViolation глотается (_set_status_safe); транзиентный сбой
            # поднимется в _tick, подписка останется и поллер повторит
            # try_finalize на следующем тике (mark_failed идемпотентен —
            # вернёт False на уже не-streaming сообщении).
            await self._set_status_safe(uid=question_uid, status="failed")
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
        # Закрываем вопрос в шине, если агент не сделал это сам. Словарь
        # статусов — владельца: 'completed' (наблюдаемо разрешён CHECK'ом),
        # не 'complete'. CheckViolation глотается (_set_status_safe);
        # транзиентный сбой → поллер повторит try_finalize на следующем тике
        # (finalize идемпотентен — вернёт False на уже complete-сообщении).
        await self._set_status_safe(uid=question_uid, status="completed")
        return "done"
