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
        initial_response_timeout_sec: int,
        event_timeout_sec: int,
        max_total_duration_sec: int,
    ) -> AsyncIterator[AgentBridgeUpdate]:
        """Async-генератор: yield events и финальный response по мере появления.

        Опрашивает БД с интервалом poll_interval_sec. По срабатыванию любого
        из трёх гейтов (initial_response / event heartbeat / max total) —
        UPDATE agent_requests SET status='timeout' + raise AgentBridgeTimeout.
        """
        loop = asyncio.get_event_loop()
        started_at = loop.time()
        last_event_at: float | None = None
        last_event_id: int | None = None

        logger.info(
            "agent_bridge: ожидание ответа: request_id=%s, "
            "gates=initial:%dс/event:%dс/total:%dс",
            request_id,
            initial_response_timeout_sec,
            event_timeout_sec,
            max_total_duration_sec,
        )

        while True:
            now = loop.time()
            elapsed = now - started_at

            # Гейт 1: абсолютный максимум на запрос (всегда активен)
            if elapsed > max_total_duration_sec:
                logger.warning(
                    "agent_bridge: гейт max_total сработал за %.1fс: "
                    "request_id=%s",
                    elapsed, request_id,
                )
                await self._requests.update_status(
                    request_id,
                    status="timeout",
                    error_message=(
                        f"превышена максимальная длительность запроса "
                        f"({max_total_duration_sec}с)"
                    ),
                )
                raise AgentBridgeTimeout(
                    f"max total duration {max_total_duration_sec}s exceeded"
                )

            # Гейт 2: первый ответ от агента (активен пока не пришло ни одного события)
            if last_event_at is None and elapsed > initial_response_timeout_sec:
                logger.warning(
                    "agent_bridge: гейт initial_response сработал за %.1fс: "
                    "request_id=%s",
                    elapsed, request_id,
                )
                await self._requests.update_status(
                    request_id,
                    status="timeout",
                    error_message=(
                        f"агент не начал отвечать за "
                        f"{initial_response_timeout_sec}с"
                    ),
                )
                raise AgentBridgeTimeout(
                    f"no initial response within {initial_response_timeout_sec}s"
                )

            # Гейт 3: heartbeat между событиями (активен после первого события)
            if (
                last_event_at is not None
                and now - last_event_at > event_timeout_sec
            ):
                logger.warning(
                    "agent_bridge: гейт heartbeat сработал за %.1fс простоя: "
                    "request_id=%s",
                    now - last_event_at, request_id,
                )
                await self._requests.update_status(
                    request_id,
                    status="timeout",
                    error_message=(
                        f"нет событий от агента {event_timeout_sec}с "
                        f"(heartbeat потерян)"
                    ),
                )
                raise AgentBridgeTimeout(
                    f"heartbeat lost — no event for {event_timeout_sec}s"
                )

            logger.debug(
                "agent_bridge polling: request_id=%s, last_seq=%s, "
                "elapsed=%.1fс",
                request_id, last_event_id, elapsed,
            )

            new_events = await self.poll_events(request_id, since_id=last_event_id)
            for ev in new_events:
                last_event_id = ev["id"]
                if last_event_at is None:
                    logger.info(
                        "agent_bridge: первое событие получено за %.2fс: "
                        "тип=%s, request_id=%s",
                        loop.time() - started_at, ev["event_type"], request_id,
                    )
                else:
                    logger.info(
                        "agent_bridge: событие seq=%s тип=%s, request_id=%s",
                        ev.get("seq"), ev["event_type"], request_id,
                    )
                last_event_at = loop.time()
                yield AgentBridgeUpdate(event=ev)

            response = await self.poll_response(request_id)
            if response is not None:
                logger.info(
                    "agent_bridge: финальный ответ получен за %.2fс: "
                    "blocks=%d, request_id=%s",
                    loop.time() - started_at,
                    len(response.get("blocks") or []),
                    request_id,
                )
                yield AgentBridgeUpdate(response=response)
                await self._requests.update_status(request_id, status="done")
                return

            await asyncio.sleep(poll_interval_sec)
