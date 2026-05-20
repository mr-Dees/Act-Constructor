"""Эндпоинты resume forward-запросов внешнего ИИ-агента.

* ``GET /conversations/{cid}/active-forward`` — отдаёт самый свежий
  активный forward-запрос беседы. 200 + JSON или 204 No Content.
* ``GET /conversations/{cid}/forward-stream/{rid}`` — SSE-стрим
  событий уже зарегистрированного forward-запроса. Использует общий
  helper :func:`stream_forward_events` (тот же, что и основной
  ``forward_bridge``), поэтому формат SSE 1:1 совпадает.

Семантика per-user семафора — как в основном SSE-эндпоинте
(``api.messages``): инкремент при открытии стрима, декремент в
``finally``. Используется тот же глобальный счётчик
``messages._active_streams_per_user``, чтобы лимит
``CHAT__MAX_PARALLEL_STREAMS_PER_USER`` учитывал и обычные сообщения,
и resume-стримы суммарно.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import get_conversation_service
from app.domains.chat.exceptions import (
    ChatStreamAlreadyActiveError,
    ConversationNotFoundError,
)
from app.domains.chat.services.conversation_service import ConversationService

logger = logging.getLogger("audit_workstation.domains.chat.api.forward_resume")


router = APIRouter(dependencies=[Depends(require_domain_access("chat"))])


@router.get(
    "/conversations/{conversation_id}/active-forward",
    summary="Активный forward-запрос внешнего агента (для resume)",
)
async def get_active_forward(
    conversation_id: str,
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """Возвращает самый свежий активный forward-запрос беседы.

    Если активных нет — 204 No Content. Иначе 200 с JSON-телом:
    ``{request_id, status, created_at}``. ``message_id`` наружу не
    отдаётся (внутреннее поле).
    """
    # Ownership: проверяем, что беседа существует и принадлежит пользователю.
    await conv_service.get(conversation_id, username)

    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )

    async with get_db() as conn:
        row = await AgentRequestRepository(conn).get_active_for_conversation(
            conversation_id, username,
        )
    if row is None:
        return Response(status_code=204)

    created_at = row.get("created_at")
    return {
        "request_id": row["id"],
        "status": row["status"],
        "created_at": (
            created_at.isoformat() if hasattr(created_at, "isoformat")
            else created_at
        ),
    }


@router.get(
    "/conversations/{conversation_id}/forward-stream/{request_id}",
    summary="Resume SSE-стрим ответа внешнего агента",
)
async def stream_forward_resume(
    conversation_id: str,
    request_id: str,
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
):
    """SSE-стрим уже зарегистрированного forward-запроса.

    Контракт: эмитит ``agent_request_started`` → reasoning-блоки →
    финальные blocks (или ``error``) → ``message_end``. Не пишет в БД,
    не запускает раннер — это работа основного forward'а.
    """
    # Ownership беседы: 404 если чужая или отсутствует.
    await conv_service.get(conversation_id, username)

    from app.core.settings_registry import get as get_domain_settings
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    from app.domains.chat.settings import ChatDomainSettings

    chat_settings = get_domain_settings("chat", ChatDomainSettings)

    # Загружаем agent_request один раз — нам нужен message_id и
    # подтверждение, что запрос принадлежит этому пользователю и беседе.
    async with get_db() as conn:
        agent_request = await AgentRequestRepository(conn).get(request_id)
    if (
        agent_request is None
        or agent_request.get("conversation_id") != conversation_id
        or agent_request.get("user_id") != username
    ):
        raise ConversationNotFoundError("Запрос агента не найден")

    message_id = agent_request.get("message_id") or ""

    # Per-user семафор: используем общий счётчик из messages.py, чтобы
    # лимит max_parallel_streams_per_user учитывал и обычные сообщения,
    # и resume-стримы суммарно.
    from app.domains.chat.api import messages as messages_module
    max_streams = chat_settings.max_parallel_streams_per_user
    if messages_module._active_streams_per_user.get(username, 0) >= max_streams:
        logger.warning(
            "Resume SSE-стрим отклонён (429): user=%s, лимит %d",
            username, max_streams,
        )
        raise ChatStreamAlreadyActiveError(
            f"Достигнут лимит одновременных запросов ({max_streams}). "
            "Дождитесь завершения одного из них.",
        )

    messages_module._active_streams_per_user[username] = (
        messages_module._active_streams_per_user.get(username, 0) + 1
    )
    stream_started_at = time.monotonic()
    logger.info(
        "Resume SSE-стрим открыт: conversation=%s, request_id=%s",
        conversation_id, request_id,
    )

    async def _resume_stream():
        from app.domains.chat.services.forward_stream import (
            stream_forward_events,
        )
        from app.domains.chat.services.streaming import (
            sse_agent_request_started,
            sse_error,
            sse_message_end,
        )

        try:
            # Первое событие — agent_request_started, чтобы фронт знал
            # request_id и переключился в режим SSE-стрима как при
            # обычной отправке сообщения.
            yield sse_agent_request_started(
                request_id=request_id,
                conversation_id=conversation_id,
            )
            async for kind, payload in stream_forward_events(
                settings=chat_settings,
                request_id=request_id,
                message_id=message_id,
                block_index_start=0,
            ):
                if kind in ("sse", "error"):
                    yield payload
            # Терминальное событие — как в основном forward-пути.
            yield sse_message_end(message_id=message_id)
        except Exception:
            logger.exception(
                "Ошибка resume SSE-стрима: conversation=%s, request_id=%s",
                conversation_id, request_id,
            )
            try:
                yield sse_error(
                    error="Внутренняя ошибка SSE-стрима.",
                    code="stream_error",
                )
                yield sse_message_end(message_id=message_id)
            except Exception:
                pass
            raise
        finally:
            current = messages_module._active_streams_per_user.get(
                username, 0,
            )
            if current <= 1:
                messages_module._active_streams_per_user.pop(username, None)
            else:
                messages_module._active_streams_per_user[username] = (
                    current - 1
                )
            duration = time.monotonic() - stream_started_at
            logger.info(
                "Resume SSE-стрим закрыт: conversation=%s, request_id=%s, "
                "длительность=%.2fс",
                conversation_id, request_id, duration,
            )

    from app.domains.chat.services.streaming import with_heartbeat

    return StreamingResponse(
        with_heartbeat(_resume_stream()),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
