"""Фоновый мониторинг использования asyncpg-пула.

Раз в N секунд снимает ``pool.get_size()`` / ``pool.get_idle_size()``.
При превышении порога эмитит WARNING в лог — без записи в БД и без
отдельной метрической таблицы. Логирование агрегируется внешней
системой (Loki/syslog), там и строится алёрт.

Этого достаточно при текущей нагрузке (JupyterHub-деплой, до 7
пользователей × 3 SSE-стрима). Тренды в БД можно добавить позже
отдельной таблицей, если понадобится исторический анализ.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("audit_workstation.domains.admin.db_pool_monitor")


class DbPoolMonitor:
    """Фоновый цикл наблюдения за asyncpg-пулом.

    Использование:

    ```python
    monitor = DbPoolMonitor(
        check_interval_sec=30.0,
        warn_ratio=0.9,
    )
    await monitor.start()
    # ...
    await monitor.stop()
    ```

    Параметры пула берутся из `app.db.connection.get_pool()`. Если пул
    не инициализирован — цикл логирует warning и завершается (no-op).
    """

    def __init__(
        self,
        *,
        check_interval_sec: float = 30.0,
        warn_ratio: float = 0.9,
    ) -> None:
        if check_interval_sec < 1.0:
            raise ValueError("check_interval_sec должен быть >= 1.0с")
        if not 0.0 < warn_ratio <= 1.0:
            raise ValueError("warn_ratio должен быть в (0.0, 1.0]")
        self._check_interval_sec = check_interval_sec
        self._warn_ratio = warn_ratio
        self._stop_event = asyncio.Event()
        self._task: asyncio.Task | None = None
        # Throttle WARNING-лога: один warning за серию подряд идущих
        # high-usage-замеров, чтобы не флудить в лог при сохраняющейся
        # высокой нагрузке. Сброс — когда usage упал ниже threshold.
        self._warning_active = False

    def get_status(self) -> dict:
        """Снимок состояния монитора для diagnostics-endpoint'а."""
        return {
            "name": "admin.db_pool_monitor",
            "running": self._task is not None and not self._task.done(),
            "check_interval_sec": self._check_interval_sec,
            "warn_ratio": self._warn_ratio,
            "warning_active": self._warning_active,
        }

    async def start(self) -> None:
        """Запускает фоновый цикл. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(
            self._loop(), name="admin-db-pool-monitor",
        )
        logger.info(
            "db_pool_monitor: запущен (interval=%.1fс, warn_ratio=%.2f)",
            self._check_interval_sec,
            self._warn_ratio,
        )

    async def stop(self) -> None:
        """Останавливает цикл и ждёт его завершения."""
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
                "db_pool_monitor: цикл не остановился за 5с, отменён",
            )
        self._task = None
        logger.info("db_pool_monitor: остановлен")

    async def _loop(self) -> None:
        from app.db.connection import get_pool

        while not self._stop_event.is_set():
            try:
                pool = get_pool()
            except RuntimeError:
                # Пул ещё не инициализирован — повторим на следующей итерации.
                logger.debug("db_pool_monitor: пул не инициализирован, пропуск")
                await self._wait(self._check_interval_sec)
                continue
            except Exception:
                logger.exception("db_pool_monitor: ошибка получения пула")
                await self._wait(self._check_interval_sec)
                continue

            try:
                size = pool.get_size()
                idle = pool.get_idle_size()
                max_size = pool.get_max_size()
                acquired = size - idle
                ratio = acquired / max_size if max_size > 0 else 0.0

                if ratio >= self._warn_ratio:
                    if not self._warning_active:
                        logger.warning(
                            "db_pool_monitor: пул близок к лимиту — "
                            "acquired=%d/%d (size=%d, idle=%d, ratio=%.2f)",
                            acquired, max_size, size, idle, ratio,
                            extra={
                                "pool_acquired": acquired,
                                "pool_max_size": max_size,
                                "pool_size": size,
                                "pool_idle": idle,
                                "pool_ratio": ratio,
                            },
                        )
                        self._warning_active = True
                else:
                    if self._warning_active:
                        logger.info(
                            "db_pool_monitor: нагрузка на пул нормализована "
                            "(acquired=%d/%d, ratio=%.2f)",
                            acquired, max_size, ratio,
                        )
                        self._warning_active = False
                    else:
                        logger.debug(
                            "db_pool_monitor: acquired=%d/%d (idle=%d, ratio=%.2f)",
                            acquired, max_size, idle, ratio,
                        )
            except Exception:
                logger.exception("db_pool_monitor: ошибка замера пула")

            await self._wait(self._check_interval_sec)

    async def _wait(self, sec: float) -> None:
        """``asyncio.sleep``, прерываемый ``stop_event``."""
        try:
            await asyncio.wait_for(self._stop_event.wait(), timeout=sec)
        except asyncio.TimeoutError:
            return
