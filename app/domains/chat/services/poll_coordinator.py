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
        watchdog_stale_factor: float = 3.0,
    ) -> None:
        if poll_max_interval_sec < poll_min_interval_sec:
            raise ValueError(
                "poll_max_interval_sec должен быть >= poll_min_interval_sec",
            )
        if poll_backoff_multiplier <= 1.0:
            raise ValueError(
                "poll_backoff_multiplier должен быть > 1.0",
            )
        if watchdog_stale_factor < 1.5:
            raise ValueError(
                "watchdog_stale_factor должен быть >= 1.5 — иначе watchdog "
                "будет рестартовать координатор от естественных пауз backoff'а",
            )
        self._poll_batch_fn = poll_batch_fn
        self._poll_min_interval_sec = poll_min_interval_sec
        self._poll_max_interval_sec = poll_max_interval_sec
        self._backoff_multiplier = poll_backoff_multiplier
        self._watchdog_stale_factor = watchdog_stale_factor

        self._subscribers: dict[str, asyncio.Queue] = {}
        self._since_seqs: dict[str, int | None] = {}
        self._lock = asyncio.Lock()
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        # Heartbeat-метка: monotonic timestamp последнего успешного тика
        # `_poll_loop`. Используется watchdog'ом для детекции зависшего
        # цикла (например, при сетевом обрыве к GP внутри
        # `_poll_batch_fn`, который не даёт исключения, а просто висит).
        self._last_tick_at: float | None = None
        self._watchdog_task: asyncio.Task | None = None
        # Счётчик перезапусков координатора watchdog'ом за весь run приложения.
        # Полезен для мониторинга / алертинга.
        self._restart_count: int = 0

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
        """Запускает фоновый цикл и watchdog. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        # Инициализируем heartbeat до старта цикла — иначе watchdog мог бы
        # сработать в первые секунды, ещё до того, как _poll_loop сделал
        # первый тик.
        self._last_tick_at = asyncio.get_event_loop().time()
        self._task = asyncio.create_task(
            self._poll_loop(), name="chat-poll-coordinator",
        )
        self._watchdog_task = asyncio.create_task(
            self._watchdog_loop(), name="chat-poll-coordinator-watchdog",
        )
        logger.info(
            "poll_coordinator: запущен (min=%.2fс, max=%.2fс, mult=%.2f, "
            "watchdog_threshold=%.1fс)",
            self._poll_min_interval_sec,
            self._poll_max_interval_sec,
            self._backoff_multiplier,
            self._poll_max_interval_sec * self._watchdog_stale_factor,
        )

    async def stop(self) -> None:
        """Останавливает watchdog и фоновый цикл, ждёт их завершения.

        Watchdog останавливается ПЕРВЫМ, иначе он мог бы рестартовать
        основной цикл прямо в момент его cancel'а и оставить orphan-task.
        """
        if self._watchdog_task is not None:
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except (asyncio.CancelledError, Exception):
                pass
            self._watchdog_task = None

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
            # Обновляем heartbeat в начале каждой итерации — watchdog
            # увидит, что цикл жив, даже если в этом тике никаких событий.
            self._last_tick_at = asyncio.get_event_loop().time()
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

    async def _watchdog_loop(self) -> None:
        """Сторожевой цикл: рестартует ``_poll_loop`` если он завис.

        Поведение:

        * Проверяет heartbeat (``_last_tick_at``) раз в
          ``_poll_max_interval_sec`` секунд.
        * Если последний тик был более ``stale_threshold`` секунд назад —
          координатор считается «зависшим»: cancel'аем старую задачу и
          запускаем новую.
        * stale_threshold = ``_poll_max_interval_sec * _watchdog_stale_factor``
          (по умолчанию 30с = 10с × 3). Достаточный зазор, чтобы не
          трогать естественные паузы backoff'а в режиме простоя.

        Почему отдельная задача, а не просто try/except в ``_poll_loop``:
        в цикле уже есть ``try/except Exception`` (он переживает любую
        ошибку внутри ``_poll_batch_fn``). Но `await` может **зависнуть**
        без исключения — например, если asyncpg-соединение прекратит
        отвечать без обрыва TCP. Тут ``try/except`` не поможет, нужен
        внешний наблюдатель с собственным таймером.
        """
        check_interval = self._poll_max_interval_sec
        stale_threshold = (
            self._poll_max_interval_sec * self._watchdog_stale_factor
        )
        loop = asyncio.get_event_loop()

        while not self._stop_event.is_set():
            try:
                await asyncio.sleep(check_interval)
            except asyncio.CancelledError:
                return

            if self._stop_event.is_set():
                return
            if self._task is None or self._task.done():
                # _poll_loop завершился (исключением или вернулся). Сам
                # цикл не возвращается без stop_event, так что это —
                # аномалия. Перезапускаем.
                logger.warning(
                    "poll_coordinator watchdog: _poll_loop умер "
                    "(task.done=%s) — рестарт",
                    self._task is not None and self._task.done(),
                )
                self._restart_poll_loop()
                continue

            last_tick = self._last_tick_at
            now = loop.time()
            if last_tick is None or (now - last_tick) > stale_threshold:
                logger.warning(
                    "poll_coordinator watchdog: heartbeat устарел "
                    "(%.1fс > %.1fс) — рестарт _poll_loop",
                    (now - last_tick) if last_tick is not None else -1.0,
                    stale_threshold,
                )
                self._restart_poll_loop()

    def _restart_poll_loop(self) -> None:
        """Cancel'ит зависший ``_poll_loop`` и запускает новый.

        Подписчики и курсоры сохраняются — после рестарта новый цикл
        продолжит polling тех же ``request_id`` с того же ``since_seqs``.
        """
        old_task = self._task
        if old_task is not None and not old_task.done():
            old_task.cancel()
        # Сбрасываем heartbeat: новый цикл сам обновит при первом тике.
        self._last_tick_at = asyncio.get_event_loop().time()
        self._task = asyncio.create_task(
            self._poll_loop(), name="chat-poll-coordinator",
        )
        self._restart_count += 1
        logger.info(
            "poll_coordinator: цикл перезапущен (всего рестартов=%d, "
            "активных подписчиков=%d)",
            self._restart_count,
            len(self._subscribers),
        )
