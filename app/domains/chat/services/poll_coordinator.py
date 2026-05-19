"""Координатор polling'а событий от внешнего ИИ-агента.

Один фоновый цикл на процесс батчит SELECT по всем активным
``request_id`` (``WHERE request_id = ANY($1)``) и раздаёт полученные
события подписчикам через ``asyncio.Queue``. Так вместо N запросов в
секунду (по runner'у на каждый forward) выполняется ровно один SELECT
за тик независимо от числа параллельных forward'ов.

Интервал polling адаптивный (exponential backoff):

* при появлении событий — сбрасывается в ``poll_min_interval_sec``;
* при пустом тике — растёт умножением на ``poll_backoff_multiplier``,
  но не выше ``poll_max_interval_sec``.

Координатор поднимается на startup через lifespan-hook
``chat.poll_coordinator`` и кладётся в ``app.state.chat_poll_coordinator``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(
    "audit_workstation.domains.chat.services.poll_coordinator",
)


# Сигнатура батч-функции: список request_id → dict[request_id -> events].
# Параметризовано Callable, чтобы координатор не тащил жёсткую зависимость
# от AgentBridgeService и был легко тестируем.
PollBatchFn = Callable[
    [list[str]], Awaitable[dict[str, list[dict]]],
]


class PollCoordinator:
    """Единый фоновый цикл polling событий из ``agent_response_events``.

    Подписчики (``agent_bridge_runner``) вызывают :meth:`subscribe` с
    ``request_id`` и читают события из возвращённой очереди. При
    завершении polling'а подписчик вызывает :meth:`unsubscribe`.
    Финальный response (``agent_responses``) полагается всё ещё на
    отдельный SELECT в runner'е — координатор раздаёт только события.

    Координатор НЕ тянет финальный response из ``agent_responses``:
    его раз в N секунд читает сам runner после поступления событий
    (модель "events → final response" — события приходят первыми,
    response сохраняется агентом в конце).
    """

    def __init__(
        self,
        *,
        poll_batch_fn: PollBatchFn,
        poll_min_interval_sec: float = 1.0,
        poll_max_interval_sec: float = 10.0,
        poll_backoff_multiplier: float = 1.5,
    ) -> None:
        if poll_max_interval_sec < poll_min_interval_sec:
            raise ValueError(
                "poll_max_interval_sec должен быть >= poll_min_interval_sec",
            )
        if poll_backoff_multiplier <= 1.0:
            raise ValueError(
                "poll_backoff_multiplier должен быть > 1.0",
            )
        self._poll_batch_fn = poll_batch_fn
        self._poll_min_interval_sec = poll_min_interval_sec
        self._poll_max_interval_sec = poll_max_interval_sec
        self._backoff_multiplier = poll_backoff_multiplier

        self._subscribers: dict[str, asyncio.Queue] = {}
        self._since_seqs: dict[str, int | None] = {}
        self._lock = asyncio.Lock()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None

    async def subscribe(self, request_id: str) -> asyncio.Queue:
        """Подписывает request_id и возвращает очередь событий.

        Повторная подписка на тот же request_id возвращает уже существующую
        очередь (идемпотентно). Это защищает от двойной подписки при
        reconcile + новом forward в одном процессе.
        """
        async with self._lock:
            if request_id in self._subscribers:
                return self._subscribers[request_id]
            queue: asyncio.Queue = asyncio.Queue()
            self._subscribers[request_id] = queue
            self._since_seqs[request_id] = None
            logger.debug(
                "poll_coordinator: подписан request_id=%s (всего=%d)",
                request_id, len(self._subscribers),
            )
            return queue

    async def unsubscribe(self, request_id: str) -> None:
        """Удаляет подписку. Идемпотентно (повторный вызов — no-op)."""
        async with self._lock:
            self._subscribers.pop(request_id, None)
            self._since_seqs.pop(request_id, None)
            logger.debug(
                "poll_coordinator: отписан request_id=%s (осталось=%d)",
                request_id, len(self._subscribers),
            )

    async def start(self) -> None:
        """Запускает фоновый цикл. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(
            self._poll_loop(), name="chat-poll-coordinator",
        )
        logger.info(
            "poll_coordinator: запущен (min=%.2fс, max=%.2fс, mult=%.2f)",
            self._poll_min_interval_sec,
            self._poll_max_interval_sec,
            self._backoff_multiplier,
        )

    async def stop(self) -> None:
        """Останавливает фоновый цикл и ждёт его завершения."""
        if self._task is None:
            return
        self._stop_event.set()
        try:
            await asyncio.wait_for(self._task, timeout=5.0)
        except asyncio.TimeoutError:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            logger.warning(
                "poll_coordinator: цикл не остановился за 5с, отменён принудительно",
            )
        self._task = None
        logger.info("poll_coordinator: остановлен")

    async def _poll_loop(self) -> None:
        """Фоновый цикл: один SELECT на тик, exponential backoff между тиками."""
        interval = self._poll_min_interval_sec
        while not self._stop_event.is_set():
            try:
                async with self._lock:
                    active_ids = list(self._subscribers.keys())
                    cursors = dict(self._since_seqs)

                if not active_ids:
                    # Подписчиков нет — спим минимальный интервал и
                    # сбрасываем backoff. Backoff копится только пока
                    # есть активные forward'ы (иначе при первой подписке
                    # после простоя ждали бы до 10с).
                    interval = self._poll_min_interval_sec
                    await self._wait(interval)
                    continue

                events_by_id = await self._poll_batch_fn(active_ids)
                any_events = False
                async with self._lock:
                    for rid, events in events_by_id.items():
                        if not events:
                            continue
                        queue = self._subscribers.get(rid)
                        if queue is None:
                            # Подписчик отписался прямо во время polling'а —
                            # события не попадут в очередь, это нормально.
                            continue
                        any_events = True
                        for ev in events:
                            await queue.put(ev)
                            seq = ev.get("seq")
                            if seq is not None:
                                self._since_seqs[rid] = seq

                # Adaptive backoff
                if any_events:
                    interval = self._poll_min_interval_sec
                else:
                    interval = min(
                        interval * self._backoff_multiplier,
                        self._poll_max_interval_sec,
                    )
            except Exception:
                logger.exception(
                    "poll_coordinator: ошибка в цикле polling — продолжаем",
                )
                interval = self._poll_min_interval_sec

            await self._wait(interval)

    async def _wait(self, sec: float) -> None:
        """``asyncio.sleep``, но прерывается ``stop_event``."""
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=sec)
        except asyncio.TimeoutError:
            return
