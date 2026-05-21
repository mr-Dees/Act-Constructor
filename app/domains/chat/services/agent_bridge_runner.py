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
    """Producer: тянет polling, инкрементально материализует ассистент-message
    в ``chat_messages``, обновляет ``agent_requests.status``.

    Phase 1 «D»: вместо накопления ``blocks: list[dict]`` в памяти runner'а
    и одного INSERT'а на финале, runner:

    1. ДО первого события создаёт draft assistant-сообщение со
       ``status='streaming'`` (``start_streaming_assistant_message``).
    2. На каждом reasoning/error-событии — короткая транзакция
       ``append_block`` (RMW под FOR UPDATE, дедуп по ``block_id``).
    3. На финале — общая транзакция ``finalize_assistant_message`` +
       ``req_repo.finalize`` (MERGE финальных блоков с уже накопленными
       reasoning'ами на стороне MessageRepository.finalize).
    4. На таймауте — отдельная короткая транзакция
       ``fail_assistant_message`` (chat_messages.status='failed' +
       error-block). Сам ``agent_requests.status='timeout'`` уже выставлен
       внутри ``_mark_timeout`` (см. ``_wait_via_coordinator``).

    Жизненный цикл pool-коннекта: **ни одна фаза не держит коннект во
    время ``await queue.get()``**. Каждое событие — отдельная короткая
    ``async with get_db()``. Иначе при N параллельных forward'ах
    PollCoordinator не получит коннект для SELECT'а → события не дойдут
    до runner-очередей → классический pool deadlock.

    После загрузки строки agent_requests читает ``parent_request_id`` и
    проставляет в :data:`app.core.config.request_id_var`, чтобы все логи
    внутри runner'а несли тот же correlation_id, что и исходный HTTP-запрос.
    """
    # Импорты внутри функции — чтобы тесты могли патчить get_db().
    from app.core.config import request_id_var
    from app.db.connection import get_db
    from app.domains.chat.exceptions import OptimisticLockFailed
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
        AgentBridgeTimeout,
    )
    from app.domains.chat.services.forward_limit import release
    from app.domains.chat.services.message_service import MessageService

    def _msg_service(conn) -> MessageService:
        """MessageService на переданном conn (для коротких транзакций)."""
        return MessageService(
            msg_repo=MessageRepository(conn),
            conv_repo=ConversationRepository(conn),
            settings=settings,
        )

    ctx_token = None
    user_id_for_release: str | None = None
    try:
        # ── Phase 1: initial read + dispatch status update ──
        async with get_db() as conn:
            req_repo = AgentRequestRepository(conn)
            request = await req_repo.get(request_id)
            if request is None:
                logger.error(
                    "agent_bridge_runner: request_id=%s не найден в БД",
                    request_id,
                )
                return

            parent = request.get("parent_request_id")
            if parent:
                ctx_token = request_id_var.set(parent)
                logger.info(
                    "agent_bridge_runner: подхватили correlation_id=%s "
                    "для request_id=%s",
                    parent, request_id,
                )

            user_id_for_release = request.get("user_id")

            if request.get("status") in ("done", "error", "timeout"):
                logger.info(
                    "agent_bridge_runner: request_id=%s уже %s, пропускаем",
                    request_id, request.get("status"),
                )
                return

            current_version: int | None = request.get("version")
            conversation_id = request["conversation_id"]
            # message_id из agent_request — он же используется для
            # детерминированного block_id reasoning-блоков:
            # `{message_id}:reasoning:{seq}`. Фронт дедупит по нему при
            # reload, иначе Resume SSE накладывал бы reasoning поверх
            # уже сохранённых N+1 раз.
            request_message_id = request.get("message_id") or ""
            agent_started = (request.get("status") == "in_progress")

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

        # ── Phase 1b: draft assistant-message со status='streaming' ──
        # ДО первого события — иначе при мгновенном финале (агент уже
        # дописал response пока runner стартовал) у нас не было бы записи,
        # к которой делать append_block. Идемпотентно по message_id:
        # репозиторий ловит UniqueViolation и возвращает existing row
        # (crash-recovery после рестарта uvicorn между genuid и save).
        async with get_db() as conn:
            await _msg_service(conn).start_streaming_assistant_message(
                message_id=request_message_id,
                conversation_id=conversation_id,
                model=settings.model,
            )

        # ── Phase 2: polling БЕЗ удержания pool-коннекта ──
        final_blocks: list[dict] = []
        token_usage: dict = {}
        timed_out = False

        if coordinator is not None:
            upd_iter = _wait_via_coordinator(
                coordinator=coordinator,
                request_id=request_id,
                settings=settings,
            )
        else:
            # Fallback (только тесты): держим один conn на polling.
            # В проде coordinator всегда поднят через lifespan-hook.
            upd_iter = _wait_via_fallback(
                request_id=request_id,
                settings=settings,
            )

        try:
            async for upd in upd_iter:
                if upd.event:
                    if not agent_started:
                        async with get_db() as conn:
                            new_version = await AgentRequestRepository(
                                conn,
                            ).update_status(
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
                    block: dict[str, Any] | None = None
                    if et == "reasoning":
                        text = payload.get("text", "")
                        if text:
                            block = {
                                "type": "reasoning",
                                "content": text,
                                "block_id": (
                                    f"{request_message_id}:reasoning:"
                                    f"{ev.get('seq')}"
                                ),
                            }
                    elif et == "error":
                        block = {
                            "type": "error",
                            "message": payload.get(
                                "message", "Ошибка внешнего агента",
                            ),
                            "block_id": (
                                f"{request_message_id}:error:"
                                f"{ev.get('seq')}"
                            ),
                        }
                        if payload.get("code"):
                            block["code"] = payload["code"]
                    # status — игнорируем (информационное событие)

                    if block is not None:
                        # Короткая транзакция на каждый event: RMW под
                        # FOR UPDATE + дедуп по block_id внутри repo.
                        # При рестарте runner'а тот же seq повторно
                        # вернётся через PollCoordinator, append_block
                        # дедупит по block_id (no-op).
                        async with get_db() as conn:
                            await MessageRepository(conn).append_block(
                                message_id=request_message_id,
                                block=block,
                            )
                if upd.response:
                    final_blocks = list(upd.response.get("blocks") or [])
                    token_usage = upd.response.get("token_usage") or {}
                    break
        except AgentBridgeTimeout as exc:
            logger.warning(
                "agent_bridge_runner: timeout request_id=%s: %s",
                request_id, exc,
            )
            timed_out = True

        if timed_out:
            # _mark_timeout уже выставил agent_requests.status='timeout'.
            # Помечаем chat_messages.status='failed' + дописываем
            # error-блок отдельной короткой транзакцией.
            error_block = {
                "type": "error",
                "message": (
                    "Внешний агент не ответил вовремя. "
                    "Попробуйте позже."
                ),
                "code": "agent_timeout",
                "block_id": f"{request_message_id}:error:1",
            }
            async with get_db() as conn:
                await _msg_service(conn).fail_assistant_message(
                    message_id=request_message_id,
                    conversation_id=conversation_id,
                    error_block=error_block,
                )
            return

        # Трансляция кнопок ответа агента в клиентские action ДО
        # сохранения: иначе в БД попадут «семантические» action_id
        # (acts.open_act_page и т.п.), фронт их не сможет обработать.
        final_blocks = await _translate_buttons_in_blocks(final_blocks)

        # ── Phase 3: финальная транзакция finalize_message + req.finalize ──
        # finalize_assistant_message мержит final_blocks с уже накопленными
        # reasoning'ами (дедуп по block_id внутри MessageRepository.finalize).
        async with get_db() as conn:
            req_repo = AgentRequestRepository(conn)
            try:
                async with conn.transaction():
                    ok = await _msg_service(
                        conn,
                    ).finalize_assistant_message(
                        message_id=request_message_id,
                        conversation_id=conversation_id,
                        final_blocks=final_blocks,
                        model=settings.model,
                        token_usage=token_usage if token_usage else None,
                    )
                    if not ok:
                        # chat_messages уже complete/failed (race с другим
                        # runner'ом / reconcile). Лог уже эмиттится внутри
                        # сервиса; req.finalize ниже всё равно переведёт
                        # agent_requests.status='done' (если version совпадёт).
                        logger.info(
                            "agent_bridge_runner: "
                            "finalize_assistant_message вернул False "
                            "(сообщение уже не streaming) request_id=%s",
                            request_id,
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
                    "request_id=%s, final_blocks=%d",
                    request_id, len(final_blocks),
                )
            except OptimisticLockFailed:
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
        # Декремент per-user счётчика активных forward'ов: гарантируем
        # релиз при любом терминальном пути (success / error / timeout /
        # crash до Phase 3). Если user_id не успели прочитать (request
        # не найден до первого SELECT'а) — релизить нечего.
        if user_id_for_release:
            release(user_id_for_release)
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


async def _mark_timeout(request_id: str, error_message: str) -> None:
    """Открывает короткий ``async with get_db()`` и пишет статус timeout.

    Вынесено отдельно, чтобы в ``_wait_via_coordinator`` не было трёх
    повторяющихся одинаковых блоков. Импорты внутри — для удобства
    патчинга get_db в тестах.
    """
    from app.db.connection import get_db
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )

    async with get_db() as conn:
        await AgentRequestRepository(conn).update_status(
            request_id,
            status="timeout",
            error_message=error_message,
        )


async def _poll_response_short_conn(request_id: str):
    """Открывает короткий ``async with get_db()`` для одного poll_response.

    Принципиально важно: коннект НЕ удерживается между poll'ами; каждый
    вызов сам берёт и возвращает conn в пул. Иначе при множественных
    параллельных runner'ах PollCoordinator не сможет получить коннект.
    """
    from app.db.connection import get_db
    from app.domains.chat.services.agent_bridge import AgentBridgeService

    async with get_db() as conn:
        return await AgentBridgeService(conn).poll_response(request_id)


async def _wait_via_coordinator(
    *,
    coordinator: PollCoordinator,
    request_id: str,
    settings: ChatDomainSettings,
):
    """Адаптер: тянет события из очереди координатора + сам опрашивает
    финальный response, эмулируя контракт ``wait_for_completion``.

    Между ``await queue.get()`` и точечными ``async with get_db()`` для
    poll_response/update_status pool-коннект НЕ удерживается.

    Реакция на финальный response — двухслойная:

    1. **Primary (push)** — внешний агент после INSERT в ``agent_responses``
       вставляет событие ``event_type='final'`` в ``agent_response_events``
       (той же транзакцией). Координатор доставляет это событие в queue,
       runner мгновенно зовёт ``poll_response`` и завершает Phase 2.
    2. **Fallback (poll)** — раз в ``poll_min_interval_sec`` секунд runner
       вызывает ``poll_response`` независимо от того, пришло событие или
       нет. Если 'final' event потерян (старая версия агента, ошибка
       записи) — fallback подхватит response за один-два тика.

    ``wait_for`` ограничен сверху ``poll_min_interval_sec``: длинные сны
    между событиями недопустимы, иначе после последнего reasoning'а до
    срабатывания event_timeout-гейта runner не видел бы готовый
    ``agent_responses`` и save ассистент-сообщения откладывался бы на
    десятки секунд. Гейты initial/event/total проверяются по
    накопленному ``elapsed`` в начале каждой итерации.
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
        poll_interval = settings.agent_bridge.poll_min_interval_sec

        while True:
            now = loop.time()
            elapsed = now - started_at

            # ── Гейты на накопленном elapsed ──
            if elapsed > max_total:
                await _mark_timeout(
                    request_id,
                    f"превышена максимальная длительность запроса "
                    f"({max_total}с)",
                )
                raise AgentBridgeTimeout(
                    f"max total duration {max_total}s exceeded",
                )
            if last_event_at is None and elapsed > initial_timeout:
                await _mark_timeout(
                    request_id,
                    f"агент не начал отвечать за {initial_timeout}с",
                )
                raise AgentBridgeTimeout(
                    f"no initial response within {initial_timeout}s",
                )
            if (
                last_event_at is not None
                and (now - last_event_at) > event_timeout
            ):
                await _mark_timeout(
                    request_id,
                    f"нет событий от агента {event_timeout}с "
                    f"(heartbeat потерян)",
                )
                raise AgentBridgeTimeout(
                    f"heartbeat lost — no event for {event_timeout}s",
                )

            # ── Короткий wait_for: poll_interval, обрезанный гейтами ──
            time_to_gate = (
                initial_timeout - elapsed
                if last_event_at is None
                else event_timeout - (now - last_event_at)
            )
            total_remaining = max_total - elapsed
            wait_for = max(
                0.0, min(poll_interval, time_to_gate, total_remaining),
            )

            try:
                ev = await asyncio.wait_for(queue.get(), timeout=wait_for)
                last_event_at = loop.time()
                et = ev.get("event_type")
                if et == "final":
                    # Служебный маркер: agent_responses записан той же
                    # транзакцией. Не эмитим наружу — финальный response
                    # пойдёт отдельным AgentBridgeUpdate(response=...).
                    response = await _poll_response_short_conn(request_id)
                    if response is not None:
                        # Статус 'done' выставляется ТОЛЬКО в
                        # req_repo.finalize(...) в одной транзакции с
                        # save_assistant_message — иначе version
                        # инкрементится и finalize падает с OptimisticLockFailed.
                        yield AgentBridgeUpdate(response=response)
                        return
                    # Гонка: 'final' пришёл, но agent_responses ещё не
                    # видно (репликация, snapshot isolation). Fallback
                    # poll ниже подхватит на следующем тике.
                    continue
                yield AgentBridgeUpdate(event=ev)
            except asyncio.TimeoutError:
                # Тик без события — нормально; ниже сделаем fallback poll.
                pass

            # ── Fallback poll: каждый тик опрашиваем agent_responses ──
            response = await _poll_response_short_conn(request_id)
            if response is not None:
                yield AgentBridgeUpdate(response=response)
                return
    finally:
        await coordinator.unsubscribe(request_id)


async def _wait_via_fallback(
    *,
    request_id: str,
    settings: ChatDomainSettings,
):
    """Резервный path без PollCoordinator (только для тестов).

    Держит **один** pool-коннект на всё время polling — это OK потому что
    в проде coordinator всегда поднят через lifespan-hook
    ``chat.poll_coordinator`` и сюда мы не попадаем. Существование этого
    пути нужно только чтобы тесты могли вызывать ``_run(...)`` напрямую,
    не поднимая координатор.
    """
    from app.db.connection import get_db
    from app.domains.chat.services.agent_bridge import AgentBridgeService

    async with get_db() as conn:
        bridge = AgentBridgeService(conn)
        async for upd in bridge.wait_for_completion(
            request_id,
            poll_min_interval_sec=(
                settings.agent_bridge.poll_min_interval_sec
            ),
            initial_response_timeout_sec=(
                settings.agent_bridge.initial_response_timeout_sec
            ),
            event_timeout_sec=settings.agent_bridge.event_timeout_sec,
            max_total_duration_sec=(
                settings.agent_bridge.max_total_duration_sec
            ),
        ):
            yield upd


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
    from app.domains.chat.services.forward_limit import acquire_no_check
    if coordinator is None:
        from app.domains.chat.deps import get_poll_coordinator
        coordinator = get_poll_coordinator()
    worker_token = str(uuid.uuid4())
    async with get_db() as conn:
        req_repo = AgentRequestRepository(conn)
        claimed_ids = await req_repo.claim_pending(
            worker_token=worker_token,
            older_than_sec=older_than_sec,
        )
        # Подгружаем user_id для каждого подхваченного запроса, чтобы
        # синхронизировать per-user счётчик forward_limit с тем, что
        # реально живёт в БД. Без этого после рестарта uvicorn юзер
        # сможет создать LIMIT+N форвардов одновременно (счётчик 0,
        # хотя в БД N pending).
        user_ids_by_rid: dict[str, str] = {}
        for rid in claimed_ids:
            row = await req_repo.get(rid)
            if row and row.get("user_id"):
                user_ids_by_rid[rid] = row["user_id"]
    count = 0
    for rid in claimed_ids:
        if not is_running(rid):
            uid = user_ids_by_rid.get(rid)
            if uid:
                acquire_no_check(uid)
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
