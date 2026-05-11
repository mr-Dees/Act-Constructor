"""Сервис обмена с внешним ИИ-агентом через таблицы БД."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import AsyncIterator

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


@dataclass
class AgentBridgeUpdate:
    """Юнит, который сервис стримит наружу: либо event, либо финальный response."""
    event: dict | None = None
    response: dict | None = None


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

    async def wait_for_completion(
        self,
        request_id: str,
        *,
        poll_interval_sec: float,
        timeout_sec: float,
    ) -> AsyncIterator[AgentBridgeUpdate]:
        """Async-генератор: yield events и финальный response по мере появления.

        Опрашивает БД с интервалом poll_interval_sec. По таймауту:
        UPDATE agent_requests SET status='timeout' + raise AgentBridgeTimeout.
        """
        deadline = asyncio.get_event_loop().time() + timeout_sec
        last_event_id: int | None = None

        while True:
            new_events = await self.poll_events(request_id, since_id=last_event_id)
            for ev in new_events:
                last_event_id = ev["id"]
                yield AgentBridgeUpdate(event=ev)

            response = await self.poll_response(request_id)
            if response is not None:
                yield AgentBridgeUpdate(response=response)
                await self._requests.update_status(request_id, status="done")
                return

            if asyncio.get_event_loop().time() > deadline:
                await self._requests.update_status(
                    request_id,
                    status="timeout",
                    error_message="agent did not respond within timeout",
                )
                raise AgentBridgeTimeout(
                    f"agent did not respond within {timeout_sec}s"
                )

            await asyncio.sleep(poll_interval_sec)
