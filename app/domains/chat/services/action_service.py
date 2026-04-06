"""Сервис выполнения действий (кнопки чата)."""

import logging
from typing import Any

from fastapi import HTTPException

from app.core.chat.buttons import get_action_handler

logger = logging.getLogger("audit_workstation.domains.chat.service.action")


class ActionService:
    """Выполнение действий по нажатию кнопок чата."""

    async def execute(
        self,
        *,
        action_id: str,
        params: dict[str, Any] | None = None,
        user_id: str,
        conversation_id: str | None = None,
    ) -> Any:
        """
        Выполняет зарегистрированное действие.

        Raises:
            HTTPException(404): если действие не найдено.
        """
        entry = get_action_handler(action_id)
        if not entry:
            raise HTTPException(
                status_code=404,
                detail=f"Действие не найдено: {action_id}",
            )

        logger.info(
            "Выполнение действия %s пользователем %s", action_id, user_id,
        )
        return await entry["handler"](
            user_id=user_id,
            conversation_id=conversation_id,
            **(params or {}),
        )
