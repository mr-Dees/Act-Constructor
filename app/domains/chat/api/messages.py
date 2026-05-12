"""Эндпоинты сообщений чата."""

import json
import logging
import time

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.v1.deps.auth_deps import get_username
from app.domains.chat.deps import (
    get_conversation_service,
    get_file_service,
    get_message_service,
)
from app.domains.chat.exceptions import ChatFileValidationError
from app.domains.chat.schemas.responses import FileUploadResponse, MessageResponse
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService

logger = logging.getLogger("audit_workstation.domains.chat.api.messages")

_kb_warned = [False]  # one-time warning suppression

router = APIRouter()


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
    accept = request.headers.get("accept", "")
    if "text/event-stream" in accept:
        if not _kb_warned[0]:
            logger.warning(
                "Forward'ы к внешнему агенту идут с пустым knowledge_bases — "
                "пробросьте список БЗ из контекста беседы (один раз на процесс)"
            )
            _kb_warned[0] = True

        logger.info("SSE-стрим открыт: conversation=%s", conversation_id)
        stream_started_at = time.monotonic()

        async def _instrumented_stream():
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
            except Exception:
                logger.exception(
                    "Ошибка в SSE-стриме: conversation=%s", conversation_id,
                )
                raise
            finally:
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
    since: int | None = Query(None, description="id последнего полученного события"),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Стримит накопленные события (с id > since) и финал в виде SSE-блоков.

    Использовать, если клиент потерял соединение во время forward'а к
    внешнему агенту: фронт перезапрашивает поток с курсором last_seen_event_id.
    """
    # Проверка владения беседой — те же права, что и при отправке сообщения
    await conv_service.get(conversation_id, username)

    async def event_stream():
        from app.core.settings_registry import get as get_domain_settings
        from app.db.connection import get_db
        from app.domains.chat.services.agent_bridge import (
            AgentBridgeService, AgentBridgeTimeout,
        )
        from app.domains.chat.services.streaming import (
            sse_block_delta, sse_block_end, sse_block_start, sse_buttons,
            sse_client_action, sse_error, sse_message_end,
        )
        from app.domains.chat.settings import ChatDomainSettings

        settings = get_domain_settings("chat", ChatDomainSettings)
        block_index = 0
        last_seen = since

        async with get_db() as conn:
            bridge = AgentBridgeService(conn)

            # Сначала отдаём уже накопленные события (если они есть на старте)
            existing = await bridge.poll_events(request_id, since_id=last_seen)
            for ev in existing:
                last_seen = ev["id"]
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
                for raw_block in existing_response["blocks"]:
                    btype = raw_block.get("type", "text")
                    if btype == "buttons":
                        yield sse_buttons(
                            buttons=raw_block.get("buttons", []),
                        )
                        continue
                    if btype == "client_action":
                        yield sse_client_action(block=raw_block)
                        continue
                    yield sse_block_start(
                        block_index=block_index, block_type=btype,
                    )
                    if btype in ("text", "code"):
                        content_key = "code" if btype == "code" else "text"
                        delta = raw_block.get(content_key, "")
                        yield sse_block_delta(
                            block_index=block_index,
                            delta=delta,
                        )
                    yield sse_block_end(block_index=block_index)
                    block_index += 1
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
                ):
                    if upd.event:
                        ev = upd.event
                        # wait_for_completion начинает с since_id=None, поэтому
                        # отфильтруем уже виденные
                        if last_seen is not None and ev["id"] <= last_seen:
                            continue
                        last_seen = ev["id"]
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
                        for raw_block in upd.response["blocks"]:
                            btype = raw_block.get("type", "text")
                            if btype == "buttons":
                                yield sse_buttons(
                                    buttons=raw_block.get("buttons", []),
                                )
                                continue
                            if btype == "client_action":
                                yield sse_client_action(block=raw_block)
                                continue
                            yield sse_block_start(
                                block_index=block_index, block_type=btype,
                            )
                            if btype in ("text", "code"):
                                content_key = "code" if btype == "code" else "text"
                                delta = raw_block.get(content_key, "")
                                yield sse_block_delta(
                                    block_index=block_index,
                                    delta=delta,
                                )
                            yield sse_block_end(block_index=block_index)
                            block_index += 1
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
