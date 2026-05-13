"""Фоновый раннер polling-задач к внешнему ИИ-агенту.

Polling отвязан от lifecycle SSE-соединения: даже если клиент закроет
вкладку посреди ответа, раннер дотянет ответ агента из мост-таблиц и
сохранит ассистент-сообщение в БД. При перезапуске uvicorn lifespan
делает реconcile через :func:`schedule_pending`.

Раннер — единственный обладатель «истины» сохранения сообщения по
forward'у. Оркестратор (SSE-поток) опрашивает те же таблицы независимо,
только чтобы транслировать события клиенту в живом режиме, и НЕ
сохраняет финальное сообщение сам.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger(
    "audit_workstation.domains.chat.agent_bridge_runner",
)

# Process-level registry: один polling-task на agent_request.
# Защищает от дублей при двойном reconcile или повторном forward.
_running: dict[str, asyncio.Task] = {}


def is_running(request_id: str) -> bool:
    """True, если для этого request_id уже крутится фоновая задача."""
    task = _running.get(request_id)
    return task is not None and not task.done()


def schedule(
    request_id: str,
    *,
    settings: ChatDomainSettings,
) -> asyncio.Task:
    """Запускает polling+сохранение в фоне, регистрирует в registry.

    Если задача для request_id уже идёт — возвращает её, нового task'а
    не создаёт (идемпотентно).
    """
    if is_running(request_id):
        return _running[request_id]
    task = asyncio.create_task(
        _run(request_id, settings=settings),
        name=f"agent-bridge-runner:{request_id}",
    )
    _running[request_id] = task
    task.add_done_callback(lambda t: _running.pop(request_id, None))
    return task


async def _run(
    request_id: str,
    *,
    settings: ChatDomainSettings,
) -> None:
    """Producer: тянет polling, сохраняет финальный ассистент-message,
    обновляет ``agent_requests.status``.

    Сами события и финальный response в БД уже пишет внешний агент
    (через мост-таблицы); раннер только финализирует сообщение и статус.
    """
    # Импорты внутри функции — чтобы тесты могли патчить get_db().
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    from app.domains.chat.repositories.conversation_repository import (
        ConversationRepository,
    )
    from app.domains.chat.repositories.message_repository import (
        MessageRepository,
    )
    from app.domains.chat.services.agent_bridge import (
        AgentBridgeService,
        AgentBridgeTimeout,
    )
    from app.domains.chat.services.message_service import MessageService

    try:
        async with get_db() as conn:
            req_repo = AgentRequestRepository(conn)
            request = await req_repo.get(request_id)
            if request is None:
                logger.error(
                    "agent_bridge_runner: request_id=%s не найден в БД",
                    request_id,
                )
                return

            # Если запрос уже финализирован — не делаем повторного polling.
            if request.get("status") in ("done", "error", "timeout"):
                logger.info(
                    "agent_bridge_runner: request_id=%s уже %s, пропускаем",
                    request_id, request.get("status"),
                )
                return

            # При первом запуске (а не при reconcile) — статус 'dispatched':
            # AW-раннер подхватил запрос и начал polling, но внешний агент
            # ещё не отвечает. 'in_progress' будет выставлен ниже, когда
            # придёт первое событие от агента.
            if request.get("status") == "pending":
                await req_repo.update_status(
                    request_id, status="dispatched",
                )

            bridge = AgentBridgeService(conn)
            blocks: list[dict] = []
            token_usage: dict = {}
            agent_started = (
                request.get("status") == "in_progress"
            )  # уже считаем что агент пишет (reconcile-сценарий)

            try:
                async for upd in bridge.wait_for_completion(
                    request_id,
                    poll_interval_sec=(
                        settings.agent_bridge.poll_interval_sec
                    ),
                    initial_response_timeout_sec=(
                        settings.agent_bridge.initial_response_timeout_sec
                    ),
                    event_timeout_sec=(
                        settings.agent_bridge.event_timeout_sec
                    ),
                    max_total_duration_sec=(
                        settings.agent_bridge.max_total_duration_sec
                    ),
                ):
                    if upd.event:
                        # Первое событие от агента — переключаем
                        # dispatched → in_progress (наблюдаемая стадия
                        # «агент пишет events»).
                        if not agent_started:
                            await req_repo.update_status(
                                request_id, status="in_progress",
                            )
                            agent_started = True
                        ev = upd.event
                        et = ev.get("event_type")
                        payload = ev.get("payload") or {}
                        if et == "reasoning":
                            text = payload.get("text", "")
                            if text:
                                blocks.append({
                                    "type": "reasoning", "content": text,
                                })
                        elif et == "error":
                            err_block: dict[str, Any] = {
                                "type": "error",
                                "message": payload.get(
                                    "message", "Ошибка внешнего агента",
                                ),
                            }
                            if payload.get("code"):
                                err_block["code"] = payload["code"]
                            blocks.append(err_block)
                        # status — игнорируем (информационное событие)
                    if upd.response:
                        blocks.extend(upd.response.get("blocks") or [])
                        token_usage = upd.response.get("token_usage") or {}
                        break
            except AgentBridgeTimeout as exc:
                logger.warning(
                    "agent_bridge_runner: timeout request_id=%s: %s",
                    request_id, exc,
                )
                blocks.append({
                    "type": "error",
                    "message": (
                        "Внешний агент не ответил вовремя. "
                        "Попробуйте позже."
                    ),
                    "code": "agent_timeout",
                })

            # Сохраняем ассистент-сообщение через MessageService.
            # MessageService привязан к conn — собираем его прямо тут.
            msg_service = MessageService(
                msg_repo=MessageRepository(conn),
                conv_repo=ConversationRepository(conn),
                settings=settings,
            )
            try:
                await msg_service.save_assistant_message(
                    conversation_id=request["conversation_id"],
                    content=blocks,
                    model=settings.model,
                    token_usage=token_usage if token_usage else None,
                )
                logger.info(
                    "agent_bridge_runner: ответ агента сохранён "
                    "request_id=%s, blocks=%d",
                    request_id, len(blocks),
                )
            except Exception:
                logger.exception(
                    "agent_bridge_runner: ошибка сохранения "
                    "ассистент-сообщения request_id=%s",
                    request_id,
                )
    except Exception:
        logger.exception(
            "agent_bridge_runner: фатальная ошибка request_id=%s",
            request_id,
        )
        # Лучшая попытка пометить статус error в отдельном коннекте.
        try:
            from app.db.connection import get_db as _get_db
            from app.domains.chat.repositories.agent_request_repository import (
                AgentRequestRepository as _ReqRepo,
            )
            async with _get_db() as conn2:
                await _ReqRepo(conn2).update_status(
                    request_id,
                    status="error",
                    error_message="runner crashed",
                )
        except Exception:
            logger.exception(
                "agent_bridge_runner: не удалось пометить статус error",
            )


async def schedule_pending(
    *,
    settings: ChatDomainSettings,
    older_than_sec: int = 30,
) -> int:
    """Lifespan-reconcile: при старте перезапускает polling для всех
    agent_requests, которые остались в pending/in_progress дольше
    ``older_than_sec`` секунд.

    Возвращает количество запущенных задач.
    """
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    async with get_db() as conn:
        pending = await AgentRequestRepository(conn).find_pending(
            older_than_sec,
        )
    count = 0
    for req in pending:
        rid = req["id"]
        if not is_running(rid):
            schedule(rid, settings=settings)
            count += 1
    if count:
        logger.info(
            "agent_bridge_runner: reconcile запустил %d задач",
            count,
        )
    return count
