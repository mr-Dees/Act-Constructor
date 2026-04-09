"""Эндпоинты действий чата (кнопки, tool calls)."""

import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.v1.deps.auth_deps import get_username
from app.domains.chat.deps import get_action_service
from app.domains.chat.services.action_service import ActionService

logger = logging.getLogger("audit_workstation.domains.chat.api.actions")

router = APIRouter()


class ExecuteActionRequest(BaseModel):
    """Запрос на выполнение действия."""

    params: dict[str, Any] | None = None
    conversation_id: str | None = None


@router.post(
    "/actions/{action_id}",
    summary="Выполнить действие",
)
async def execute_action(
    action_id: str,
    body: ExecuteActionRequest,
    username: str = Depends(get_username),
    service: ActionService = Depends(get_action_service),
):
    """Выполняет действие по нажатию кнопки чата."""
    result = await service.execute(
        action_id=action_id,
        params=body.params,
        user_id=username,
        conversation_id=body.conversation_id,
    )
    return result
