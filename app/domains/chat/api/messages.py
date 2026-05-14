"""Эндпоинты сообщений чата."""

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import (
    get_conversation_service,
    get_file_service,
    get_message_service,
)
from app.domains.chat.exceptions import (
    ChatFileValidationError,
    ChatStreamAlreadyActiveError,
)
from app.domains.chat.schemas.responses import FileUploadResponse, MessageResponse
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService

logger = logging.getLogger("audit_workstation.domains.chat.api.messages")

_kb_warned = [False]  # one-time warning suppression

# Per-user счётчик активных SSE-стримов. Защищает от того, что один
# пользователь параллельно держит несколько open-ended SSE-каналов
# (например, открыл несколько вкладок и отправил сообщение в каждую).
# Корректно работает только в режиме single-worker (см. app/core/singleton_lock.py
# и app/main.py lifespan): в multi-worker дикт был бы у каждого процесса свой.
_active_streams_per_user: dict[str, int] = {}


def is_user_streaming(user_id: str) -> bool:
    """Возвращает True, если у пользователя есть хотя бы один активный SSE-стрим.

    Используется сервисами, которым нужно отказать в деструктивной операции
    (например, удалении беседы) пока идёт генерация ответа ассистента.
    """
    return _active_streams_per_user.get(user_id, 0) > 0


# Защита роли крепится явно на роутер (defense in depth) — см. конфигурацию
# в conversations.py.
router = APIRouter(dependencies=[Depends(require_domain_access("chat"))])


@router.post(
    "/conversations/{conversation_id}/messages",
    summary="Отправить сообщение",
)
async def send_message(
    conversation_id: str,
    request: Request,
    message: str = Form(...),
    domains: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
    file_service: FileService = Depends(get_file_service),
):
    """
    Отправляет сообщение в беседу.

    Принимает FormData: message, domains (JSON-список), files.
    Если Accept: text/event-stream — возвращает SSE-поток,
    иначе — JSON-ответ.
    """
    logger.info(
        "Получен запрос пользователя: conversation=%s, message_len=%d, "
        "files=%d",
        conversation_id, len(message or ""), len(files),
    )
    logger.debug(
        "Тело запроса (truncated): message=%r, domains=%r",
        (message[:500] + "...") if message and len(message) > 500 else message,
        domains,
    )

    # Проверяем, что беседа существует и принадлежит пользователю
    await conv_service.get(conversation_id, username)

    # Парсим домены из JSON-строки
    domains_list: list[str] | None = None
    if domains:
        try:
            domains_list = json.loads(domains)
        except json.JSONDecodeError:
            domains_list = [d.strip() for d in domains.split(",") if d.strip()]

    # Валидируем количество файлов
    max_files = file_service.settings.max_files_per_message
    if len(files) > max_files:
        raise ChatFileValidationError(
            f"Слишком много файлов (максимум {max_files}).",
        )

    # Читаем все файлы и проверяем суммарный размер
    file_entries: list[tuple[UploadFile, bytes]] = []
    total_size = 0
    for upload_file in files:
        file_data = await upload_file.read()
        total_size += len(file_data)
        file_entries.append((upload_file, file_data))

    max_total = file_service.settings.max_total_file_size
    if total_size > max_total:
        max_mb = max_total / (1024 * 1024)
        raise ChatFileValidationError(
            f"Суммарный размер файлов слишком велик (максимум {max_mb:.0f} МБ).",
        )

    # Сохраняем файлы после валидации
    file_blocks: list[dict] = []
    for upload_file, file_data in file_entries:
        saved = await file_service.save_file(
            conversation_id=conversation_id,
            user_id=username,
            filename=upload_file.filename or "file",
            mime_type=upload_file.content_type or "application/octet-stream",
            file_data=file_data,
        )
        file_blocks.append({
            "type": "file",
            "file_id": saved["id"],
            "filename": saved["filename"],
            "mime_type": saved["mime_type"],
            "file_size": saved["file_size"],
        })

    # Per-user семафор: один пользователь — один открытый SSE-стрим.
    # Проверка ДО save_user_message и Orchestrator: иначе одинаковое сообщение
    # появится в БД дважды (попытка-1 уже сохранена, попытка-2 получила 429).
    # Single-worker гарантируется acquire_singleton_lock в lifespan, поэтому
    # in-process счётчика достаточно.
    accept = request.headers.get("accept", "")
    is_sse = "text/event-stream" in accept
    if is_sse and _active_streams_per_user.get(username, 0) > 0:
        logger.warning(
            "SSE-стрим отклонён (429): user=%s, уже активен", username,
        )
        raise ChatStreamAlreadyActiveError(
            "Уже идёт активный стрим. Дождитесь окончания или "
            "отмените предыдущий.",
        )

    # Сохраняем пользовательское сообщение
    await msg_service.save_user_message(
        conversation_id=conversation_id,
        content=message,
        user_id=username,
        file_blocks=file_blocks if file_blocks else None,
    )

    # Создаём оркестратор (lazy import для избежания циклических зависимостей)
    from app.domains.chat.services.orchestrator import Orchestrator

    orchestrator = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
    )

    # Определяем режим ответа по Accept header
    # TODO(forward): пробросить список knowledge_bases из контекста беседы,
    # когда фронт начнёт передавать выбранные пользователем БЗ.
    if is_sse:
        if not _kb_warned[0]:
            logger.warning(
                "Forward'ы к внешнему агенту идут с пустым knowledge_bases — "
                "пробросьте список БЗ из контекста беседы (один раз на процесс)"
            )
            _kb_warned[0] = True

        # Захватываем слот семафора. Декремент — в finally генератора.
        _active_streams_per_user[username] = (
            _active_streams_per_user.get(username, 0) + 1
        )

        logger.info("SSE-стрим открыт: conversation=%s", conversation_id)
        stream_started_at = time.monotonic()

        async def _instrumented_stream():
            from app.domains.chat.services.streaming import (
                sse_error,
                sse_message_end,
            )
            try:
                async for chunk in orchestrator.run_stream(
                    conversation_id=conversation_id,
                    user_message=message,
                    domains=domains_list,
                    file_blocks=file_blocks if file_blocks else None,
                    user_id=username,
                    knowledge_bases=[],
                ):
                    yield chunk
            except (asyncio.CancelledError, GeneratorExit):
                # Клиент дисконнектнулся (закрыл вкладку, обрыв связи).
                # Пытаемся отправить финальные SSE-события — если канал
                # уже мёртв, yield бросит исключение, его глушим. Дальше
                # пробрасываем исходное исключение, чтобы корректно
                # завершить генератор и освободить ресурсы.
                logger.info(
                    "SSE-стрим отменён клиентом: conversation=%s",
                    conversation_id,
                )
                try:
                    yield sse_error(
                        error="Соединение разорвано клиентом.",
                        code="client_disconnected",
                    )
                    yield sse_message_end(message_id="")
                except Exception:
                    pass
                raise
            except Exception:
                logger.exception(
                    "Ошибка в SSE-стриме: conversation=%s", conversation_id,
                )
                # Гарантируем финальное message_end даже если оркестратор
                # упал до того, как успел его эмитнуть. Падение yield
                # внутри (мёртвый канал) — глушим.
                try:
                    yield sse_error(
                        error="Внутренняя ошибка SSE-стрима.",
                        code="stream_error",
                    )
                    yield sse_message_end(message_id="")
                except Exception:
                    pass
                raise
            finally:
                # Декремент семафора независимо от пути выхода
                # (нормальный конец / disconnect / exception).
                current = _active_streams_per_user.get(username, 0)
                if current <= 1:
                    _active_streams_per_user.pop(username, None)
                else:
                    _active_streams_per_user[username] = current - 1
                logger.info(
                    "SSE-стрим закрыт: conversation=%s, длительность=%.2fс",
                    conversation_id,
                    time.monotonic() - stream_started_at,
                )

        return StreamingResponse(
            _instrumented_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    # Полный ответ (не стриминг)
    try:
        result = await orchestrator.run(
            conversation_id=conversation_id,
            user_message=message,
            domains=domains_list,
            file_blocks=file_blocks if file_blocks else None,
        )
    except Exception:
        logger.exception(
            "Ошибка обработки сообщения: conversation=%s", conversation_id,
        )
        raise
    return result


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=list[MessageResponse],
    summary="История сообщений",
)
async def get_messages(
    conversation_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
):
    """Возвращает историю сообщений беседы."""
    # Проверяем принадлежность беседы пользователю
    await conv_service.get(conversation_id, username)

    return await msg_service.get_history(
        conversation_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/conversations/{conversation_id}/agent-request/{request_id}/stream",
    summary="Возобновить SSE-стрим ответа агента после обрыва соединения",
)
async def resume_agent_request_stream(
    conversation_id: str,
    request_id: str,
    since: int | None = Query(None, description="seq последнего полученного события"),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Стримит накопленные события (с seq > since) и финал в виде SSE-блоков.

    Использовать, если клиент потерял соединение во время forward'а к
    внешнему агенту: фронт перезапрашивает поток с курсором last_seen_seq.
    Курсор по seq (не id), потому что id в GP не монотонен по distributed-таблице.
    """
    # Проверка владения беседой — те же права, что и при отправке сообщения
    await conv_service.get(conversation_id, username)

    # Проверка владения agent_request: он должен принадлежать той же беседе.
    # Без этой проверки авторизованный пользователь, перехватив UUID, мог
    # бы прочитать чужой ответ агента, подставив свой conversation_id.
    from app.db.connection import get_db
    from app.domains.chat.exceptions import ConversationNotFoundError
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )

    async with get_db() as conn:
        agent_request = await AgentRequestRepository(conn).get(request_id)
    if agent_request is None or agent_request["conversation_id"] != conversation_id:
        raise ConversationNotFoundError("Запрос агента не найден")

    async def event_stream():
        from app.core.settings_registry import get as get_domain_settings
        from app.domains.chat.services.agent_bridge import (
            AgentBridgeService,
            AgentBridgeTimeout,
        )
        from app.domains.chat.services.block_emitter import emit_response_blocks
        from app.domains.chat.services.streaming import (
            sse_block_delta,
            sse_block_end,
            sse_block_start,
            sse_error,
            sse_message_end,
        )
        from app.domains.chat.settings import ChatDomainSettings

        settings = get_domain_settings("chat", ChatDomainSettings)
        block_index = 0
        last_seen = since

        # Подстраховка: гарантируем, что polling-задача для request_id
        # точно работает. Реconcile в lifespan ловит зависшие запросы
        # с лагом ≥30с — этот intervals ещё может быть «слепым»; явный
        # schedule идемпотентен (registry в agent_bridge_runner проверяет
        # is_running) и не запустит дублирующий polling, если runner уже
        # крутится. Сохранение финального ассистент-сообщения — только
        # на стороне runner'а (single source of truth), resume лишь
        # транслирует события в SSE.
        from app.domains.chat.services.agent_bridge_runner import schedule
        schedule(request_id, settings=settings)

        async with get_db() as conn:
            bridge = AgentBridgeService(conn)

            # Сначала отдаём уже накопленные события (если они есть на старте)
            existing = await bridge.poll_events(
                request_id, since_seq=last_seen,
            )
            for ev in existing:
                last_seen = ev["seq"]
                if ev["event_type"] == "reasoning":
                    text = (ev["payload"] or {}).get("text", "")
                    if not text:
                        continue
                    # Каждый reasoning-чанк — отдельный сворачиваемый блок.
                    yield sse_block_start(
                        block_index=block_index, block_type="reasoning",
                    )
                    yield sse_block_delta(block_index=block_index, delta=text)
                    yield sse_block_end(block_index=block_index)
                    block_index += 1
                elif ev["event_type"] == "error":
                    payload = ev["payload"] or {}
                    yield sse_error(
                        error=payload.get("message", "Ошибка внешнего агента"),
                        code=payload.get("code"),
                    )

            # Проверяем, не появился ли уже финальный ответ
            existing_response = await bridge.poll_response(request_id)
            if existing_response is not None:
                async for sse, idx in emit_response_blocks(
                    existing_response["blocks"],
                    block_index_start=block_index,
                ):
                    block_index = idx + 1
                    yield sse
                yield sse_message_end(
                    message_id=str(request_id),
                    model=settings.model,
                    token_usage=existing_response.get("token_usage") or None,
                )
                return

            # Иначе — ждём дальше через wait_for_completion
            try:
                async for upd in bridge.wait_for_completion(
                    request_id,
                    poll_interval_sec=settings.agent_bridge.poll_interval_sec,
                    initial_response_timeout_sec=settings.agent_bridge.initial_response_timeout_sec,
                    event_timeout_sec=settings.agent_bridge.event_timeout_sec,
                    max_total_duration_sec=settings.agent_bridge.max_total_duration_sec,
                    since_seq=last_seen,
                ):
                    if upd.event:
                        ev = upd.event
                        last_seen = ev["seq"]
                        if ev["event_type"] == "reasoning":
                            text = (ev["payload"] or {}).get("text", "")
                            if not text:
                                continue
                            # Каждый reasoning-чанк — отдельный
                            # сворачиваемый блок.
                            yield sse_block_start(
                                block_index=block_index,
                                block_type="reasoning",
                            )
                            yield sse_block_delta(
                                block_index=block_index, delta=text,
                            )
                            yield sse_block_end(block_index=block_index)
                            block_index += 1
                        elif ev["event_type"] == "error":
                            payload = ev["payload"] or {}
                            yield sse_error(
                                error=payload.get("message", "Ошибка внешнего агента"),
                                code=payload.get("code"),
                            )
                    if upd.response:
                        async for sse, idx in emit_response_blocks(
                            upd.response["blocks"],
                            block_index_start=block_index,
                        ):
                            block_index = idx + 1
                            yield sse
                        yield sse_message_end(
                            message_id=str(request_id),
                            model=settings.model,
                            token_usage=upd.response.get("token_usage") or None,
                        )
                        return
            except AgentBridgeTimeout:
                yield sse_error(
                    error="Внешний агент не ответил вовремя. Попробуйте позже.",
                    code="agent_timeout",
                )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
