"""Сервис обмена с внешним ИИ-агентом через таблицы БД."""

from __future__ import annotations

import logging
import uuid

import asyncpg

from app.domains.chat.repositories.agent_event_repository import (
    AgentEventRepository,
)
from app.domains.chat.repositories.agent_request_repository import (
    AgentRequestRepository,
)
from app.domains.chat.repositories.agent_response_repository import (
    AgentResponseRepository,
)

logger = logging.getLogger("audit_workstation.domains.chat.services.agent_bridge")


class AgentBridgeTimeout(Exception):
    """Внешний агент не успел ответить в выделенное время."""


class AgentBridgeService:
    """Тонкий фасад над тремя репозиториями моста к внешнему ИИ-агенту."""

    def __init__(self, conn: asyncpg.Connection) -> None:
        self._conn = conn
        self._requests = AgentRequestRepository(conn)
        self._events = AgentEventRepository(conn)
        self._responses = AgentResponseRepository(conn)

    async def send(
        self,
        *,
        conversation_id: str,
        message_id: str,
        user_id: str,
        domain_name: str | None,
        knowledge_bases: list[str],
        last_user_message: str,
        history: list[dict],
        files: list[dict],
    ) -> str:
        """Создаёт строку в agent_requests, возвращает свежий request_id."""
        request_id = str(uuid.uuid4())
        await self._requests.create(
            id=request_id,
            conversation_id=conversation_id,
            message_id=message_id,
            user_id=user_id,
            domain_name=domain_name,
            knowledge_bases=knowledge_bases,
            history=history,
            files=files,
            last_user_message=last_user_message,
        )
        logger.debug(
            "agent_request создан: id=%s conv=%s msg=%s",
            request_id, conversation_id, message_id,
        )
        return request_id

    async def poll_events(
        self,
        request_id: str,
        *,
        since_id: int | None,
    ) -> list[dict]:
        """Возвращает новые события агента (с id > since_id)."""
        return await self._events.poll(request_id, since_id=since_id)

    async def poll_response(self, request_id: str) -> dict | None:
        """Возвращает финальный ответ агента или None, если ещё не готов."""
        return await self._responses.get_by_request_id(request_id)
