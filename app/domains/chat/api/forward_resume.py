"""Эндпоинты resume forward-запросов внешнего ИИ-агента.

``GET /conversations/{cid}/active-forward`` — отдаёт самый свежий
активный forward-запрос беседы. 200 + JSON или 204 No Content.
Используется фронтом при загрузке беседы: если найден активный
forward — фронт переоткрывает SSE-стрим (см. следующий коммит,
``forward-stream``).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import get_conversation_service
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
