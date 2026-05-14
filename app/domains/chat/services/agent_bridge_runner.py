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
import uuid
from typing import Any

from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger(
    "audit_workstation.domains.chat.agent_bridge_runner",
)

# Process-level registry: один polling-task на agent_request.
# Защищает от дублей при двойном reconcile или повторном forward в рамках
# одного процесса. Single-worker гарантирован через таблицу
# {PREFIX}app_singleton_lock (admin-миграция) + acquire_singleton_lock в
# app/main.py lifespan — поэтому in-process защиты достаточно, cross-worker
# гонок быть не должно.
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

            # Текущая версия для optimistic locking; при конфликте — abort.
            current_version: int | None = request.get("version")

            # При первом запуске (а не при reconcile) — статус 'dispatched':
            # AW-раннер подхватил запрос и начал polling, но внешний агент
            # ещё не отвечает. 'in_progress' будет выставлен ниже, когда
            # придёт первое событие от агента.
            if request.get("status") == "pending":
                new_version = await req_repo.update_status(
                    request_id,
                    status="dispatched",
                    expected_version=current_version,
                )
                if new_version is None:
                    logger.warning(
                        "agent_bridge_runner: version conflict при "
                        "переводе в dispatched, request_id=%s "
                        "expected_version=%s status_at_read=%s "
                        "worker_token_at_read=%s — итерация прервана "
                        "(другой воркер уже владеет запросом)",
                        request_id,
                        current_version,
                        request.get("status"),
                        request.get("worker_token"),
                        extra={
                            "agent_request_id": request_id,
                            "transition": "pending->dispatched",
                            "expected_version": current_version,
                            "status_at_read": request.get("status"),
                            "worker_token_at_read": request.get(
                                "worker_token",
                            ),
                        },
                    )
                    return
                current_version = new_version

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
                            new_version = await req_repo.update_status(
                                request_id,
                                status="in_progress",
                                expected_version=current_version,
                            )
                            if new_version is None:
                                logger.warning(
                                    "agent_bridge_runner: version "
                                    "conflict при переводе в "
                                    "in_progress, request_id=%s "
                                    "expected_version=%s — abort "
                                    "(другой воркер обновил agent_request)",
                                    request_id,
                                    current_version,
                                    extra={
                                        "agent_request_id": request_id,
                                        "transition": (
                                            "dispatched->in_progress"
                                        ),
                                        "expected_version": current_version,
                                    },
                                )
                                return
                            current_version = new_version
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

            # Трансляция кнопок ответа агента в клиентские action ДО
            # сохранения: иначе в БД попадут «семантические» action_id
            # (acts.open_act_page и т.п.), фронт их не сможет обработать.
            blocks = await _translate_buttons_in_blocks(blocks)

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


async def shutdown_running(timeout_sec: float = 5.0) -> int:
    """Graceful shutdown polling-задач при остановке приложения.

    Отменяет все задачи в registry и ждёт их завершения с таймаутом.
    Записи в ``agent_requests`` остаются в текущем статусе (``dispatched``
    или ``in_progress``); следующий запуск подхватит их через
    :func:`schedule_pending` reconcile (older_than_sec=30 по умолчанию).

    Возвращает количество отменённых задач.
    """
    if not _running:
        return 0
    tasks = list(_running.values())
    for task in tasks:
        if not task.done():
            task.cancel()
    done, pending = await asyncio.wait(tasks, timeout=timeout_sec)
    if pending:
        logger.warning(
            "agent_bridge_runner: shutdown — %d задач не успели завершиться "
            "за %.1fs (reconcile подхватит при следующем старте)",
            len(pending), timeout_sec,
        )
    logger.info(
        "agent_bridge_runner: shutdown отменил %d задач (завершено=%d, висят=%d)",
        len(tasks), len(done), len(pending),
    )
    return len(tasks)


async def schedule_pending(
    *,
    settings: ChatDomainSettings,
    older_than_sec: int = 30,
) -> int:
    """Lifespan-reconcile: при старте подхватывает зависшие запросы и
    запускает polling-задачу на каждый.

    Использует атомарный ``claim_pending`` (UPDATE ... RETURNING id) с
    уникальным worker_token этого процесса. Если воркеров несколько и
    одновременно поднялись после рестарта uvicorn — каждый получит
    непересекающееся подмножество строк, double-claim физически
    невозможен.

    in-process защита через ``is_running`` оставлена на случай повторного
    вызова в том же процессе (например, ручной перезапуск reconcile);
    cross-worker защита — на уровне БД через worker_token.

    Возвращает количество запущенных задач.
    """
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    worker_token = str(uuid.uuid4())
    async with get_db() as conn:
        claimed_ids = await AgentRequestRepository(conn).claim_pending(
            worker_token=worker_token,
            older_than_sec=older_than_sec,
        )
    count = 0
    for rid in claimed_ids:
        if not is_running(rid):
            schedule(rid, settings=settings)
            count += 1
    if count:
        logger.info(
            "agent_bridge_runner: reconcile worker=%s запустил %d задач",
            worker_token, count,
        )
    return count


async def _translate_buttons_in_blocks(blocks: list[dict]) -> list[dict]:
    """Транслирует кнопки внутри buttons-блоков ответа агента.

    Для каждого блока type='buttons' заменяет buttons на переведённые
    через button_translator (acts.open_act_page → open_url с реальным
    URL, и т.п.). Остальные блоки возвращаются как есть.
    """
    from app.domains.chat.services.button_translator import translate_buttons

    result: list[dict] = []
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "buttons":
            translated = await translate_buttons(block.get("buttons") or [])
            new_block = dict(block)
            new_block["buttons"] = translated
            result.append(new_block)
        else:
            result.append(block)
    return result
