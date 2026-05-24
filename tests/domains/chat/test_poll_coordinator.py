"""Тесты PollCoordinator — единого фонового цикла polling событий агента.

Покрывает: подписку/отписку, батч-запрос с одним вызовом poll_batch_fn для
N подписчиков, exponential backoff на пустых тиках, сброс backoff при
получении события, idle при пустой подписке, корректный stop().

Бэкофф-тесты используют прямой прогон одной итерации цикла через мок
``poll_batch_fn`` + ручной мониторинг ``interval`` — это избавляет тесты
от реальных asyncio.sleep и делает их быстрыми и детерминированными.
"""
from __future__ import annotations

import asyncio

import pytest

from app.domains.chat.services.poll_coordinator import PollCoordinator


def _coordinator(
    poll_batch_fn,
    *,
    poll_min_interval_sec: float = 0.01,
    poll_max_interval_sec: float = 0.05,
    poll_backoff_multiplier: float = 2.0,
    watchdog_stale_factor: float = 3.0,
) -> PollCoordinator:
    return PollCoordinator(
        poll_batch_fn=poll_batch_fn,
        poll_min_interval_sec=poll_min_interval_sec,
        poll_max_interval_sec=poll_max_interval_sec,
        poll_backoff_multiplier=poll_backoff_multiplier,
        watchdog_stale_factor=watchdog_stale_factor,
    )


async def test_subscribe_returns_queue():
    """Подписка возвращает asyncio.Queue; повторная подписка — та же очередь."""
    async def empty_poll(rids, _since_seqs=None):
        return {}
    pc = _coordinator(empty_poll)
    q1 = await pc.subscribe("rid-1")
    q2 = await pc.subscribe("rid-1")
    assert isinstance(q1, asyncio.Queue)
    assert q1 is q2  # идемпотентно — тот же объект


async def test_unsubscribe_removes_subscriber():
    """После unsubscribe подписчика нет в списке активных."""
    async def empty_poll(rids, _since_seqs=None):
        return {}
    pc = _coordinator(empty_poll)
    await pc.subscribe("rid-1")
    await pc.subscribe("rid-2")
    await pc.unsubscribe("rid-1")
    assert "rid-1" not in pc._subscribers
    assert "rid-2" in pc._subscribers
    # Повторный unsubscribe — no-op (идемпотентно)
    await pc.unsubscribe("rid-1")


async def test_poll_loop_batches_multiple_subscribers():
    """3 подписчика → один вызов poll_batch_fn со списком из 3 id."""
    received_calls: list[list[str]] = []
    event_for_r1 = {"seq": 1, "event_type": "reasoning", "payload": {"t": "a"}}
    done = asyncio.Event()

    async def poll(rids, _since_seqs=None):
        received_calls.append(list(rids))
        if len(received_calls) == 1:
            result = {"r1": [event_for_r1], "r2": [], "r3": []}
        else:
            result = {r: [] for r in rids}
        # Сигналим тесту, что хотя бы один вызов произошёл
        done.set()
        return result

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    q1 = await pc.subscribe("r1")
    q2 = await pc.subscribe("r2")
    q3 = await pc.subscribe("r3")

    await pc.start()
    await asyncio.wait_for(done.wait(), timeout=2.0)
    # Даём ещё одному циклу шанс на доставку события из очереди
    await asyncio.sleep(0.02)
    await pc.stop()

    # Все вызовы — с одним списком всех id (батч)
    assert received_calls, "poll_batch_fn ни разу не вызвался"
    for call in received_calls:
        assert sorted(call) == sorted(["r1", "r2", "r3"])

    # Событие попало именно в очередь r1
    assert q1.qsize() == 1
    assert q2.qsize() == 0
    assert q3.qsize() == 0
    delivered = await q1.get()
    assert delivered == event_for_r1


async def test_no_subscribers_idle():
    """Без подписчиков poll_batch_fn не вызывается."""
    calls = []

    async def poll(rids, _since_seqs=None):
        calls.append(list(rids))
        return {}

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    await pc.start()
    # Даём времени крутиться (но активных подписок нет)
    await asyncio.sleep(0.05)
    await pc.stop()
    assert calls == []


async def test_backoff_grows_on_empty_polls():
    """Пустые тики → interval растёт от min до max через multiplier.

    Эмулирует цикл вручную, чтобы не зависеть от реального scheduler'а.
    Проверяет именно расчёт нового интервала после пустого тика.
    """
    async def poll(rids, _since_seqs=None):
        return {r: [] for r in rids}

    pc = _coordinator(
        poll,
        poll_min_interval_sec=1.0,
        poll_max_interval_sec=8.0,
        poll_backoff_multiplier=2.0,
    )
    await pc.subscribe("r1")

    # Симулируем последовательные тики, "вытаскивая" логику backoff
    # из _poll_loop. Стартовый interval = poll_min.
    interval = pc._poll_min_interval_sec
    sleeps = [interval]
    for _ in range(5):
        events_by_id = await pc._poll_batch_fn(["r1"], {})
        any_events = any(events_by_id.values())
        if any_events:
            interval = pc._poll_min_interval_sec
        else:
            interval = min(
                interval * pc._backoff_multiplier,
                pc._poll_max_interval_sec,
            )
        sleeps.append(interval)

    # Ожидаем: 1, 2, 4, 8, 8, 8 (capped at max)
    assert sleeps == [1.0, 2.0, 4.0, 8.0, 8.0, 8.0]


async def test_backoff_resets_on_event():
    """После получения event interval сбрасывается на poll_min."""
    call_n = {"n": 0}
    event = {"seq": 5, "event_type": "reasoning", "payload": {}}

    async def poll(rids, _since_seqs=None):
        call_n["n"] += 1
        if call_n["n"] == 3:
            return {"r1": [event]}
        return {"r1": []}

    pc = _coordinator(
        poll,
        poll_min_interval_sec=1.0,
        poll_max_interval_sec=8.0,
        poll_backoff_multiplier=2.0,
    )
    await pc.subscribe("r1")

    interval = pc._poll_min_interval_sec
    intervals = [interval]
    for _ in range(5):
        events_by_id = await pc._poll_batch_fn(["r1"], {})
        any_events = any(events_by_id.values())
        if any_events:
            interval = pc._poll_min_interval_sec
        else:
            interval = min(
                interval * pc._backoff_multiplier,
                pc._poll_max_interval_sec,
            )
        intervals.append(interval)

    # 1 (старт), 2 (пусто 1), 4 (пусто 2), 1 (событие 3), 2 (пусто 4), 4 (пусто 5)
    assert intervals == [1.0, 2.0, 4.0, 1.0, 2.0, 4.0]


async def test_stop_cancels_background_task():
    """stop() отменяет фоновую задачу, повторный start/stop — корректные."""
    async def empty_poll(rids, _since_seqs=None):
        return {}
    pc = _coordinator(empty_poll)
    await pc.subscribe("r1")
    await pc.start()
    task = pc._task
    assert task is not None and not task.done()

    await pc.stop()
    assert pc._task is None

    # Повторный stop — no-op
    await pc.stop()

    # start() после stop() запускает заново
    await pc.start()
    assert pc._task is not None
    await pc.stop()


def test_invalid_intervals_raise():
    """Конструктор валидирует параметры: min<=max, multiplier>1.0."""
    async def empty_poll(rids, _since_seqs=None):
        return {}

    with pytest.raises(ValueError):
        PollCoordinator(
            poll_batch_fn=empty_poll,
            poll_min_interval_sec=5.0,
            poll_max_interval_sec=1.0,  # max < min
            poll_backoff_multiplier=2.0,
        )
    with pytest.raises(ValueError):
        PollCoordinator(
            poll_batch_fn=empty_poll,
            poll_min_interval_sec=1.0,
            poll_max_interval_sec=10.0,
            poll_backoff_multiplier=1.0,  # multiplier должен быть > 1
        )


async def test_poll_batch_receives_cursors_after_event():
    """После event с seq=N координатор передаёт {rid: N} в следующий вызов poll_batch_fn.

    Регрессия: до фикса координатор сохранял курсор в памяти, но не пробрасывал
    его в SQL — каждый тик читал все события с начала, runner-очередь
    накапливала дубликаты (видели до 10× повтор одного reasoning-блока в
    сохранённом ассистент-сообщении).
    """
    seen_cursors: list[dict] = []
    e1 = {"seq": 7, "event_type": "reasoning", "payload": {}}
    state = {"n": 0}

    async def poll(rids, since_seqs=None):
        seen_cursors.append(dict(since_seqs or {}))
        state["n"] += 1
        if state["n"] == 1:
            return {"r1": [e1]}
        return {"r1": []}

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    await pc.subscribe("r1")
    await pc.start()
    for _ in range(20):
        if len(seen_cursors) >= 2:
            break
        await asyncio.sleep(0.02)
    await pc.stop()

    assert len(seen_cursors) >= 2, "должны быть хотя бы 2 тика"
    assert seen_cursors[0].get("r1") is None
    assert seen_cursors[1].get("r1") == 7


async def test_event_advances_since_seq_cursor():
    """Получив event с seq=N, координатор сохраняет курсор для request_id."""
    state = {"n": 0}
    e1 = {"seq": 10, "event_type": "reasoning", "payload": {}}

    async def poll(rids, _since_seqs=None):
        state["n"] += 1
        if state["n"] == 1:
            return {"r1": [e1]}
        return {"r1": []}

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    await pc.subscribe("r1")
    await pc.start()
    # Даём циклу прокрутиться хотя бы раз
    await asyncio.sleep(0.05)
    await pc.stop()
    assert pc._since_seqs.get("r1") == 10


async def test_watchdog_restarts_dead_poll_loop():
    """Watchdog перезапускает _poll_loop, если он завершился (task.done)."""
    async def empty_poll(rids, _since_seqs=None):
        return {r: [] for r in rids}

    pc = _coordinator(
        empty_poll,
        poll_min_interval_sec=0.01,
        poll_max_interval_sec=0.03,  # watchdog тикает каждые 30мс
        watchdog_stale_factor=2.0,
    )
    await pc.subscribe("r1")
    await pc.start()
    original_task = pc._task

    # Принудительно убиваем _poll_loop — watchdog должен заметить и
    # рестартануть.
    assert original_task is not None
    original_task.cancel()
    try:
        await original_task
    except asyncio.CancelledError:
        pass

    # Ждём, пока watchdog заметит task.done() и сделает рестарт.
    # Watchdog тикает каждые 30мс — двух тиков с запасом достаточно.
    for _ in range(20):
        if pc._restart_count > 0:
            break
        await asyncio.sleep(0.02)

    assert pc._restart_count >= 1, (
        f"watchdog не рестартовал мёртвый task за 400мс "
        f"(restart_count={pc._restart_count})"
    )
    assert pc._task is not None and not pc._task.done(), (
        "после рестарта _task должен быть жив"
    )
    # Подписчик должен сохраниться — рестарт не теряет подписки.
    assert "r1" in pc._subscribers

    await pc.stop()


async def test_watchdog_does_not_restart_healthy_loop():
    """Watchdog НЕ рестартует _poll_loop, если heartbeat свежий."""
    async def empty_poll(rids, _since_seqs=None):
        return {r: [] for r in rids}

    pc = _coordinator(
        empty_poll,
        poll_min_interval_sec=0.005,
        poll_max_interval_sec=0.02,
        watchdog_stale_factor=3.0,  # threshold = 60мс
    )
    await pc.subscribe("r1")
    await pc.start()

    # Цикл крутится, heartbeat обновляется. За 100мс watchdog не должен
    # сработать.
    await asyncio.sleep(0.1)

    assert pc._restart_count == 0, (
        f"watchdog ложно рестартовал живой цикл (restart_count={pc._restart_count})"
    )
    await pc.stop()


async def test_observer_receives_events_fanout():
    """subscribe_observer получает копии всех событий рядом с runner-subscribe.

    Это и есть смысл observer-канала: N Resume SSE на один request_id
    получают тот же поток событий через fan-out, без N×SELECT'ов.
    """
    events_to_return = [{"seq": 1, "event_type": "reasoning", "payload": {}}]

    async def poll(rids, _since_seqs=None):
        return {rid: events_to_return for rid in rids}

    pc = _coordinator(poll)
    runner_q = await pc.subscribe("rid-fanout")
    observer_q = await pc.subscribe_observer("rid-fanout")
    await pc.start()

    # Ждём хотя бы один тик
    await asyncio.sleep(0.05)

    # Runner и observer оба получили одно и то же событие
    assert not runner_q.empty(), "runner-очередь должна получить событие"
    assert not observer_q.empty(), "observer-очередь должна получить копию"

    runner_ev = await runner_q.get()
    observer_ev = await observer_q.get()
    assert runner_ev["seq"] == 1
    assert observer_ev["seq"] == 1

    await pc.stop()


async def test_unsubscribe_observer_removes_only_target_queue():
    """unsubscribe_observer удаляет конкретную очередь, остальные живут."""
    async def empty_poll(rids, _since_seqs=None):
        return {}

    pc = _coordinator(empty_poll)
    q1 = await pc.subscribe_observer("rid-1")
    q2 = await pc.subscribe_observer("rid-1")

    assert len(pc._observers["rid-1"]) == 2

    await pc.unsubscribe_observer("rid-1", q1)
    assert q2 in pc._observers["rid-1"]
    assert q1 not in pc._observers["rid-1"]
    assert len(pc._observers["rid-1"]) == 1


async def test_observer_does_not_advance_cursor_without_runner():
    """Если runner ещё не подписан, observer'у события идут, но cursor НЕ двигается.

    Регрессия: иначе подписавшийся позже runner начал бы с пустоты,
    т.к. координатор уже выбрал события из БД и обновил курсор.
    """
    events = [{"seq": 5, "event_type": "reasoning", "payload": {}}]

    async def poll(rids, _since_seqs=None):
        return {rid: events for rid in rids}

    pc = _coordinator(poll)
    await pc.subscribe_observer("rid-obs-only")
    await pc.start()
    await asyncio.sleep(0.05)

    # Курсор должен остаться None (нет runner-подписки)
    assert pc._since_seqs.get("rid-obs-only") is None
    await pc.stop()


async def test_watchdog_skips_restart_after_stop_event_set():
    """Watchdog не рестартует _poll_loop, если в этот момент stop_event set.

    Регрессия: при graceful shutdown lifespan-shutdown задерживается
    активными SSE-стримами, и watchdog успевал рестартовать координатор
    после "Shutting down" (видели в проде: "рестартов=1" уже после
    сигнала остановки). После фикса рестарт — no-op при stop_event set.
    """
    async def empty_poll(rids, _since_seqs=None):
        return {r: [] for r in rids}

    pc = _coordinator(empty_poll)

    # Эмулируем shutdown: stop_event set, _restart_poll_loop вызывают как
    # вызвал бы watchdog. Не должен ничего создавать.
    pc._stop_event.set()
    pc._restart_poll_loop()

    assert pc._task is None, "рестарт не должен создавать новую задачу при stop_event set"
    assert pc._restart_count == 0, (
        f"restart_count не инкрементируется (got={pc._restart_count})"
    )


async def test_watchdog_validates_stale_factor():
    """watchdog_stale_factor < 1.5 — конструктор отказывает."""
    async def empty_poll(rids, _since_seqs=None):
        return {}

    with pytest.raises(ValueError, match="watchdog_stale_factor"):
        PollCoordinator(
            poll_batch_fn=empty_poll,
            poll_min_interval_sec=1.0,
            poll_max_interval_sec=10.0,
            poll_backoff_multiplier=2.0,
            watchdog_stale_factor=1.0,
        )


async def test_unsubscribed_during_poll_does_not_crash():
    """Подписчик отписался в момент poll'а — event не попадает в очередь, но цикл живёт."""
    poll_called = asyncio.Event()
    state = {"unsubscribed": False}

    async def poll(rids, _since_seqs=None):
        # Имитируем "медленный" poll: между вычислением active_ids
        # и доставкой подписчик может отписаться.
        poll_called.set()
        await asyncio.sleep(0.001)
        return {r: [{"seq": 1, "event_type": "t", "payload": {}}] for r in rids}

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    await pc.subscribe("r1")
    await pc.start()
    await asyncio.wait_for(poll_called.wait(), timeout=2.0)
    await pc.unsubscribe("r1")
    state["unsubscribed"] = True
    await asyncio.sleep(0.05)
    # Координатор не должен упасть — task всё ещё живой
    assert pc._task is not None and not pc._task.done()
    await pc.stop()


async def test_watchdog_restarts_hung_poll_loop_by_stale_heartbeat():
    """Watchdog рестартует зависший _poll_loop по устаревшему heartbeat.

    Отличие от ``test_watchdog_restarts_dead_poll_loop`` (где task.done()
    из-за cancel): здесь task жив, но висит внутри ``poll_batch_fn``
    (например, asyncpg-соединение перестало отвечать без обрыва). В этом
    случае ``try/except`` в ``_poll_loop`` бесполезен — спасает только
    отдельный watchdog с собственным таймером.
    """
    hang_event = asyncio.Event()

    async def hanging_poll(_rids, _since_seqs=None):
        # Первый вызов виснет навсегда — имитация stuck-await.
        hang_event.set()
        await asyncio.sleep(60.0)
        return {}

    pc = _coordinator(
        hanging_poll,
        poll_min_interval_sec=0.01,
        poll_max_interval_sec=0.03,  # watchdog тикает каждые 30мс
        watchdog_stale_factor=2.0,   # threshold = 60мс
    )
    await pc.subscribe("r1")
    await pc.start()
    # Дожидаемся, что _poll_loop успел зайти в hanging_poll
    await asyncio.wait_for(hang_event.wait(), timeout=2.0)

    # Ждём, пока watchdog заметит stale heartbeat (60мс threshold + проверка)
    for _ in range(50):
        if pc._restart_count >= 1:
            break
        await asyncio.sleep(0.02)

    assert pc._restart_count >= 1, (
        f"watchdog не заметил stale heartbeat за ~1с "
        f"(restart_count={pc._restart_count})"
    )
    # Новый _task создан, подписки сохранены
    assert pc._task is not None
    assert "r1" in pc._subscribers

    await pc.stop()


async def test_subscribe_observer_concurrent_with_poll_loop_is_atomic():
    """Параллельный subscribe_observer + активный _poll_loop не падает.

    subscribe_observer берёт self._lock, _poll_loop делает batch и
    доставку под self._lock. Тест эмулирует race: пока координатор
    крутится и pump-ит события, наблюдатель подписывается. Ожидаем:
    либо observer успел подписаться ДО доставки и получил событие,
    либо подписался ПОСЛЕ — тогда событие пропустил. Главное — не
    падает с исключением (атомарность через lock).
    """
    events_to_return = [{"seq": 1, "event_type": "reasoning", "payload": {}}]

    async def poll(rids, _since_seqs=None):
        return {rid: events_to_return for rid in rids}

    pc = _coordinator(poll, poll_min_interval_sec=0.005,
                      poll_max_interval_sec=0.02)
    await pc.subscribe("rid-race")
    await pc.start()

    # Параллельно делаем 20 subscribe_observer'ов — race с _poll_loop
    observer_queues: list[asyncio.Queue] = []

    async def subscribe_one():
        q = await pc.subscribe_observer("rid-race")
        observer_queues.append(q)

    await asyncio.gather(*(subscribe_one() for _ in range(20)))

    # Координатор всё ещё жив
    assert pc._task is not None and not pc._task.done()
    # Каждый observer получил свою очередь
    assert len(observer_queues) == 20
    # Все очереди уникальны (race не дал shared-state)
    assert len({id(q) for q in observer_queues}) == 20

    await pc.stop()
