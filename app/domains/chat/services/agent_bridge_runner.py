"""Фоновый раннер polling-задач к внешнему ИИ-агенту.

Polling отвязан от lifecycle SSE-соединения: даже если клиент закроет
вкладку посреди ответа, раннер дотянет ответ агента из мост-таблиц и
сохранит ассистент-сообщение в БД. При перезапуске uvicorn lifespan
делает реconcile через :func:`schedule_pending`.

Раннер — единственный обладатель «истины» сохранения сообщения по
forward'у. Оркестратор (SSE-поток) опрашивает те же таблицы независимо,
только чтобы транслировать события клиенту в живом режиме, и НЕ
сохраняет финальное сообщение сам.

С переходом на :class:`PollCoordinator` раннер больше не держит
собственный polling-цикл: он подписывается на координатор и читает
события из ``asyncio.Queue``. Финальный response (``agent_responses``)
раннер по-прежнему запрашивает сам — реже, по одному SELECT на
проверку.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from app.domains.chat.services.poll_coordinator import PollCoordinator
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
    coordinator: PollCoordinator | None = None,
) -> asyncio.Task:
    """Запускает polling+сохранение в фоне, регистрирует в registry.

    Если задача для request_id уже идёт — возвращает её, нового task'а
    не создаёт (идемпотентно).

    ``coordinator`` — общий :class:`PollCoordinator`; если передан,
    события читаются из его очереди. Если не передан, runner откатывается
    к собственному циклу через :meth:`AgentBridgeService.wait_for_completion`
    (резервный путь для тестов и сценариев без поднятого координатора).
    """
    if is_running(request_id):
        return _running[request_id]
    if coordinator is None:
        # Lazy-import чтобы избежать циклической зависимости при импорте
        # модуля раннера из deps (deps импортирует services).
        from app.domains.chat.deps import get_poll_coordinator
        coordinator = get_poll_coordinator()
    task = asyncio.create_task(
        _run(request_id, settings=settings, coordinator=coordinator),
        name=f"agent-bridge-runner:{request_id}",
    )
    _running[request_id] = task
    task.add_done_callback(lambda t: _running.pop(request_id, None))
    return task


async def _run(
    request_id: str,
    *,
    settings: ChatDomainSettings,
    coordinator: PollCoordinator | None = None,
) -> None:
    """Producer: тянет polling, сохраняет финальный ассистент-message,
    обновляет ``agent_requests.status``.

    Сами события и финальный response в БД уже пишет внешний агент
    (через мост-таблицы); раннер только финализирует сообщение и статус.

    После загрузки строки agent_requests читает ``parent_request_id`` и
    проставляет в :data:`app.core.config.request_id_var`, чтобы все логи
    внутри runner'а несли тот же correlation_id, что и исходный HTTP-запрос.
    """
    # Импорты внутри функции — чтобы тесты могли патчить get_db().
    from app.core.config import request_id_var
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

    ctx_token = None
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

            # Связываем логи runner'а с HTTP-запросом, который создал
            # agent_request. Если parent отсутствует (reconcile или
            # background-вызов) — оставляем дефолтный "-".
            parent = request.get("parent_request_id")
            if parent:
                ctx_token = request_id_var.set(parent)
                logger.info(
                    "agent_bridge_runner: подхватили correlation_id=%s "
                    "для request_id=%s",
                    parent, request_id,
                )

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

            # Источник событий: либо общий PollCoordinator (батч SELECT
            # на всех активных request_id), либо собственный цикл
            # wait_for_completion (резервный путь без координатора).
            if coordinator is not None:
                upd_iter = _wait_via_coordinator(
                    bridge=bridge,
                    coordinator=coordinator,
                    request_id=request_id,
                    req_repo=req_repo,
                    settings=settings,
                )
            else:
                upd_iter = bridge.wait_for_completion(
                    request_id,
                    poll_min_interval_sec=(
                        settings.agent_bridge.poll_min_interval_sec
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
                )
            try:
                async for upd in upd_iter:
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

            from app.domains.chat.exceptions import OptimisticLockFailed

            # Атомарная финализация: save_assistant_message + finalize
            # выполняются в одной транзакции. Если finalize не проходит
            # optimistic lock (другой воркер уже финализировал запрос),
            # поднимаем OptimisticLockFailed → транзакция откатывается →
            # message НЕ сохранён, статус остаётся in_progress для reconcile.
            msg_service = MessageService(
                msg_repo=MessageRepository(conn),
                conv_repo=ConversationRepository(conn),
                settings=settings,
            )
            try:
                async with conn.transaction():
                    await msg_service.save_assistant_message(
                        conversation_id=request["conversation_id"],
                        content=blocks,
                        model=settings.model,
                        token_usage=token_usage if token_usage else None,
                    )
                    success = await req_repo.finalize(
                        request_id,
                        current_version,
                    )
                    if not success:
                        raise OptimisticLockFailed(
                            f"agent_request finalize version conflict "
                            f"request_id={request_id} "
                            f"expected_version={current_version}",
                        )
                logger.info(
                    "agent_bridge_runner: ответ агента сохранён "
                    "request_id=%s, blocks=%d",
                    request_id, len(blocks),
                )
            except OptimisticLockFailed:
                # Транзакция уже откатилась. Message не сохранён.
                # Статус остаётся in_progress — reconcile подхватит.
                logger.warning(
                    "agent_bridge_runner: optimistic lock conflict при "
                    "финализации request_id=%s expected_version=%s — "
                    "rollback, reconcile подхватит",
                    request_id, current_version,
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
    finally:
        # Откатываем correlation_id, чтобы ContextVar не «протёк» в чужие
        # короутины. ContextVar в asyncio.Task изолирован per-task, но reset
        # обязателен на случай, если runner запущен в общем контексте
        # (например, тесты вызывают _run напрямую без create_task).
        if ctx_token is not None:
            from app.core.config import request_id_var as _rid
            _rid.reset(ctx_token)


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


async def _wait_via_coordinator(
    *,
    bridge: Any,
    coordinator: PollCoordinator,
    request_id: str,
    req_repo: Any,
    settings: ChatDomainSettings,
):
    """Адаптер: тянет события из очереди координатора + сам опрашивает
    финальный response, эмулируя контракт ``wait_for_completion``.

    События берутся из ``asyncio.Queue`` подписки, response — отдельным
    SELECT после каждой пачки событий и периодически по таймауту. Гейты
    таймаута (initial / heartbeat / total) считаются здесь так же, как в
    ``AgentBridgeService.wait_for_completion``.
    """
    from app.domains.chat.services.agent_bridge import (
        AgentBridgeTimeout,
        AgentBridgeUpdate,
    )

    queue = await coordinator.subscribe(request_id)
    try:
        loop = asyncio.get_event_loop()
        started_at = loop.time()
        last_event_at: float | None = None
        initial_timeout = settings.agent_bridge.initial_response_timeout_sec
        event_timeout = settings.agent_bridge.event_timeout_sec
        max_total = settings.agent_bridge.max_total_duration_sec

        while True:
            # Допустимое время до следующего события — минимум среди всех
            # гейтов, чтобы asyncio.wait_for() прервал ожидание ровно
            # тогда, когда сработает гейт.
            now = loop.time()
            elapsed = now - started_at
            if elapsed > max_total:
                await req_repo.update_status(
                    request_id,
                    status="timeout",
                    error_message=(
                        f"превышена максимальная длительность запроса "
                        f"({max_total}с)"
                    ),
                )
                raise AgentBridgeTimeout(
                    f"max total duration {max_total}s exceeded",
                )
            if last_event_at is None:
                remaining = initial_timeout - elapsed
            else:
                remaining = event_timeout - (now - last_event_at)
            total_remaining = max_total - elapsed
            wait_for = max(0.0, min(remaining, total_remaining))

            try:
                ev = await asyncio.wait_for(queue.get(), timeout=wait_for)
            except asyncio.TimeoutError:
                # Сработал гейт — определяем какой именно.
                now2 = loop.time()
                if last_event_at is None and now2 - started_at > initial_timeout:
                    await req_repo.update_status(
                        request_id,
                        status="timeout",
                        error_message=(
                            f"агент не начал отвечать за {initial_timeout}с"
                        ),
                    )
                    raise AgentBridgeTimeout(
                        f"no initial response within {initial_timeout}s",
                    )
                if (
                    last_event_at is not None
                    and now2 - last_event_at > event_timeout
                ):
                    await req_repo.update_status(
                        request_id,
                        status="timeout",
                        error_message=(
                            f"нет событий от агента {event_timeout}с "
                            f"(heartbeat потерян)"
                        ),
                    )
                    raise AgentBridgeTimeout(
                        f"heartbeat lost — no event for {event_timeout}s",
                    )
                # Иначе проверим финальный response.
                response = await bridge.poll_response(request_id)
                if response is not None:
                    # Статус 'done' выставляется ТОЛЬКО внутри
                    # req_repo.finalize(...) в той же транзакции, что и
                    # save_assistant_message. Если поставить done здесь —
                    # инкрементится version и finalize упадёт с
                    # OptimisticLockFailed, ассистент-сообщение не сохранится.
                    yield AgentBridgeUpdate(response=response)
                    return
                continue

            last_event_at = loop.time()
            yield AgentBridgeUpdate(event=ev)

            # После каждого события проверяем, не появился ли финальный
            # response (агент дописал в agent_responses).
            response = await bridge.poll_response(request_id)
            if response is not None:
                # См. коммент выше: 'done' ставит только finalize().
                yield AgentBridgeUpdate(response=response)
                return
    finally:
        await coordinator.unsubscribe(request_id)


async def schedule_pending(
    *,
    settings: ChatDomainSettings,
    coordinator: PollCoordinator | None = None,
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
    if coordinator is None:
        from app.domains.chat.deps import get_poll_coordinator
        coordinator = get_poll_coordinator()
    worker_token = str(uuid.uuid4())
    async with get_db() as conn:
        claimed_ids = await AgentRequestRepository(conn).claim_pending(
            worker_token=worker_token,
            older_than_sec=older_than_sec,
        )
    count = 0
    for rid in claimed_ids:
        if not is_running(rid):
            schedule(rid, settings=settings, coordinator=coordinator)
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
