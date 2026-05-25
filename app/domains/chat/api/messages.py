"""Эндпоинты сообщений чата."""

import asyncio
import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.core.responses import PaginatedResponse
from app.domains.chat.deps import (
    get_conversation_service,
    get_file_service,
    get_message_service,
    get_rate_limiter,
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

    # Per-user rate limit: защита от злоупотребления (до сохранения сообщения)
    await get_rate_limiter().check_and_consume(username)

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
    if is_sse:
        from app.core.settings_registry import get as get_domain_settings
        from app.domains.chat.settings import ChatDomainSettings

        chat_settings = get_domain_settings("chat", ChatDomainSettings)
        max_streams = chat_settings.max_parallel_streams_per_user
        if _active_streams_per_user.get(username, 0) >= max_streams:
            logger.warning(
                "SSE-стрим отклонён (429): user=%s, достигнут лимит %d",
                username, max_streams,
            )
            raise ChatStreamAlreadyActiveError(
                f"Достигнут лимит одновременных запросов ({max_streams}). "
                "Дождитесь завершения одного из них.",
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

    # ID будущего assistant-сообщения. Генерируем здесь, чтобы он совпадал
    # с тем, что попадёт в БД через _save_assistant_message — на нём строится
    # детерминированный block_id ClientActionBlock.
    assistant_message_id = str(uuid.uuid4())

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

        # Audit-сервис подцепили через conv_service в deps; используем
        # его же для записи событий жизненного цикла SSE-стрима. Изоляция
        # try/except — defense in depth: audit-сервис уже глушит свои
        # исключения внутри, но в тестах audit_service может быть подменён
        # MagicMock'ом без AsyncMock для конкретных методов.
        audit_service = getattr(conv_service, "audit_service", None)
        if audit_service is not None:
            try:
                await audit_service.log_stream_started(
                    username=username,
                    conversation_id=conversation_id,
                )
            except Exception:
                logger.warning(
                    "Не удалось записать audit log_stream_started",
                    exc_info=True,
                )

        async def _instrumented_stream():
            from app.domains.chat.services.streaming import (
                sse_error,
                sse_message_end,
                with_heartbeat,
            )
            stream_outcome = "completed"
            try:
                inner = orchestrator.run_stream(
                    conversation_id=conversation_id,
                    user_message=message,
                    message_id=assistant_message_id,
                    domains=domains_list,
                    file_blocks=file_blocks if file_blocks else None,
                    user_id=username,
                    knowledge_bases=[],
                )
                # Heartbeat обязателен, иначе silent forward (polling
                # внешнего агента без событий) скрывает client disconnect
                # на 5 минут — orchestrator занимает per-user семафор
                # впустую, см. CLAUDE.md «Heartbeat обязателен в SSE».
                async for chunk in with_heartbeat(inner):
                    yield chunk
            except (asyncio.CancelledError, GeneratorExit):
                # Клиент дисконнектнулся (закрыл вкладку, обрыв связи).
                # Пытаемся отправить финальные SSE-события — если канал
                # уже мёртв, yield бросит исключение, его глушим. Дальше
                # пробрасываем исходное исключение, чтобы корректно
                # завершить генератор и освободить ресурсы.
                stream_outcome = "client_disconnected"
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
                stream_outcome = "stream_error"
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
                duration = time.monotonic() - stream_started_at
                logger.info(
                    "SSE-стрим закрыт: conversation=%s, длительность=%.2fс",
                    conversation_id, duration,
                )
                if audit_service is not None:
                    try:
                        if stream_outcome == "completed":
                            await audit_service.log_stream_completed(
                                username=username,
                                conversation_id=conversation_id,
                                duration_sec=duration,
                            )
                        else:
                            await audit_service.log_stream_aborted(
                                username=username,
                                conversation_id=conversation_id,
                                reason=stream_outcome,
                                duration_sec=duration,
                            )
                    except Exception:
                        logger.warning(
                            "Не удалось записать audit финала SSE-стрима",
                            exc_info=True,
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
            message_id=assistant_message_id,
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
    response_model=PaginatedResponse[MessageResponse],
    summary="История сообщений",
)
async def get_messages(
    conversation_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
):
    """Возвращает историю сообщений беседы."""
    # Проверяем принадлежность беседы пользователю
    await conv_service.get(conversation_id, username)

    items, total = await msg_service.get_history(
        conversation_id,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse[MessageResponse](
        items=items, total=total, limit=limit, offset=offset,
    )


# Легаси-эндпоинт `/agent-request/{request_id}/stream` удалён в Phase 2 «D»:
# его полностью заменил `/forward-stream/{request_id}` (см.
# app.domains.chat.api.forward_resume). Старый путь дублировал логику
# Resume SSE, не использовал PollCoordinator и обходил server-authoritative
# state — после рефакторинга оба эти отличия стали критичны.
#
# Фронт (chat-stream.js::resume()) уже использует `/forward-stream/...`
# как primary path. Catch-fallback `_resumeAgentRequest` (вызывающий
# старый URL) будет удалён в Phase 3 — параллельно работает frontend-агент.
