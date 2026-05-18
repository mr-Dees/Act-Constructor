"""Накопитель метрик с двойным триггером flush (по размеру буфера и по таймеру).

Снижает нагрузку на БД при высокочастотной записи метрик: вместо одной
INSERT-транзакции на запись — пакет до ``max_batch_size`` записей за один
``executemany`` внутри одной транзакции.

Триггеры flush:

- Размер буфера достиг ``max_batch_size`` — мгновенный flush.
- Прошло ``flush_interval_sec`` секунд после последнего flush — flush даже
  если буфер не полный (фоновая задача в ``start()``).
- Вызван ``stop()`` — финальный flush (например, при shutdown).

Защита от переполнения: если ``max_buffer_size`` превышен (например,
БД недоступна и фоновый flush падает) — старые записи дропаются с одной
warning-записью, чтобы не съесть память процесса.

Класс — generic по типу записи: каждый поток метрик создаёт собственный
батчер со своим ``flush_callback``. Глобального singleton'а нет.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, Generic, TypeVar

T = TypeVar("T")

logger = logging.getLogger("audit_workstation.metrics_batcher")


class MetricsBatcher(Generic[T]):
    """Асинхронный аккумулятор метрик с двойным триггером flush."""

    def __init__(
        self,
        flush_callback: Callable[[list[T]], Awaitable[None]],
        max_batch_size: int = 100,
        flush_interval_sec: float = 5.0,
        max_buffer_size: int = 10000,
        name: str = "metrics_batcher",
    ):
        """Инициализирует батчер.

        :param flush_callback: корутина, принимающая список записей и
            записывающая их в БД (например, ``repo.record_many``).
        :param max_batch_size: размер пакета для мгновенного flush.
        :param flush_interval_sec: интервал фонового flush в секундах.
        :param max_buffer_size: защитный потолок буфера; при превышении
            старые записи дропаются (вместо OOM).
        :param name: имя батчера для логов.
        """
        self._flush_callback = flush_callback
        self._max_batch_size = max_batch_size
        self._flush_interval_sec = flush_interval_sec
        self._max_buffer_size = max_buffer_size
        self._name = name

        self._buffer: list[T] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._shutdown = False
        # Серилизует stop() относительно текущего flush, чтобы финальный
        # flush не пересекался с фоновым.
        self._flush_in_progress = asyncio.Lock()

    async def add(self, record: T) -> None:
        """Добавляет запись в буфер; при достижении ``max_batch_size`` — flush.

        Под локом: добавление + проверка размера + защитный дроп старых
        записей при превышении ``max_buffer_size``.
        """
        async with self._lock:
            self._buffer.append(record)
            if len(self._buffer) > self._max_buffer_size:
                dropped = len(self._buffer) - self._max_buffer_size
                self._buffer = self._buffer[-self._max_buffer_size:]
                logger.warning(
                    "Батчер %s: буфер переполнен, дропнуто %d старых записей",
                    self._name,
                    dropped,
                )
            if len(self._buffer) >= self._max_batch_size:
                await self._flush_locked()

    async def start(self) -> None:
        """Стартует фоновую задачу периодического flush.

        Идемпотентно: повторный вызов после старта — no-op.
        """
        if self._task is not None and not self._task.done():
            return
        self._shutdown = False
        self._task = asyncio.create_task(
            self._run_periodic(),
            name=f"metrics_batcher:{self._name}",
        )

    async def stop(self) -> None:
        """Останавливает фоновую задачу и делает финальный flush.

        Идемпотентно: повторный вызов после остановки — no-op. Если ``start()``
        не вызывался — тоже работает (просто финальный flush).
        """
        if self._shutdown:
            return
        self._shutdown = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        # Финальный flush — под общим flush-локом, чтобы не пересечься с
        # последним фоновым тиком, если он уже стартовал.
        async with self._flush_in_progress:
            async with self._lock:
                await self._flush_locked()

    async def _run_periodic(self) -> None:
        """Фоновый цикл: спим интервал, потом flush."""
        try:
            while not self._shutdown:
                await asyncio.sleep(self._flush_interval_sec)
                if self._shutdown:
                    break
                async with self._flush_in_progress:
                    async with self._lock:
                        await self._flush_locked()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Фоновая задача не должна молча умирать — логируем и выходим.
            # stop() закроет батчер штатно.
            logger.exception(
                "Батчер %s: фоновая задача упала", self._name,
            )

    async def _flush_locked(self) -> None:
        """Сбрасывает буфер через ``flush_callback``.

        Вызывается под ``self._lock``. Копирует буфер локально, очищает его
        ДО вызова callback'а — чтобы новые ``add()`` не ждали БД-операцию.

        Если callback бросает исключение — лог warning, записи НЕ возвращаются
        в буфер (упало = упало, ретраи не плодим, иначе при стабильном падении
        БД буфер раздуется до OOM).
        """
        if not self._buffer:
            return
        batch = self._buffer
        self._buffer = []
        try:
            await self._flush_callback(batch)
        except Exception:
            logger.warning(
                "Батчер %s: flush_callback упал, %d записей потеряно",
                self._name,
                len(batch),
                exc_info=True,
            )
