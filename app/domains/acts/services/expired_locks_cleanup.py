"""Фоновая задача очистки просроченных блокировок актов.

Каждые ``interval_sec`` секунд выполняет

    UPDATE {acts} SET locked_by = NULL, locked_at = NULL, lock_expires_at = NULL
    WHERE lock_expires_at <= CURRENT_TIMESTAMP AND locked_by IS NOT NULL

Опирается на частичный индекс ``idx_{PREFIX}acts_lock_expires``
(``WHERE lock_expires_at IS NOT NULL``) — он уже есть в обеих
схемах (PG/GP) и делает поиск кандидатов на снятие дешёвым.

Раз в час (или каждые ``log_every_n_cycles`` тиков) пишет суммарную
статистику в лог — чтобы в проде можно было видеть, сколько локов
снимается фоном.
"""

from __future__ import annotations

import asyncio
import logging

from app.db.connection import get_adapter, get_db

logger = logging.getLogger("audit_workstation.domains.acts.expired_locks_cleanup")


class ExpiredLocksCleanupTask:
    """Asyncio-задача, периодически снимающая просроченные блокировки актов."""

    def __init__(
        self,
        *,
        interval_sec: float = 60.0,
        log_every_n_cycles: int = 60,
    ):
        """
        :param interval_sec: период вызова UPDATE.
        :param log_every_n_cycles: каждые ``N`` циклов писать суммарную
            статистику в INFO-лог (60 циклов × 60 сек = раз в час по дефолту).
        """
        self._interval_sec = interval_sec
        self._log_every_n_cycles = max(1, log_every_n_cycles)
        self._task: asyncio.Task | None = None
        self._shutdown = False
        # Аккумуляторы статистики между INFO-логами.
        self._cycles_since_log = 0
        self._cleaned_since_log = 0

    def get_status(self) -> dict:
        """Снимок состояния задачи для diagnostics-endpoint'а."""
        return {
            "name": "acts.expired_locks_cleanup",
            "running": self._task is not None and not self._task.done(),
            "interval_sec": self._interval_sec,
            "cycles_since_log": self._cycles_since_log,
            "cleaned_since_log": self._cleaned_since_log,
        }

    async def start(self) -> None:
        """Стартует фоновую задачу. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._shutdown = False
        self._task = asyncio.create_task(
            self._run(), name="acts:expired_locks_cleanup",
        )

    async def stop(self) -> None:
        """Останавливает фоновую задачу. Идемпотентно."""
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

    async def _run(self) -> None:
        """Основной цикл: спим интервал, потом cleanup."""
        try:
            while not self._shutdown:
                try:
                    await asyncio.sleep(self._interval_sec)
                except asyncio.CancelledError:
                    raise
                if self._shutdown:
                    break
                try:
                    cleaned = await self._cleanup_once()
                    self._cleaned_since_log += cleaned
                    self._cycles_since_log += 1
                    if self._cycles_since_log >= self._log_every_n_cycles:
                        logger.info(
                            "Очистка просроченных блокировок актов: "
                            "за последние %d циклов снято %d блокировок",
                            self._cycles_since_log,
                            self._cleaned_since_log,
                        )
                        self._cycles_since_log = 0
                        self._cleaned_since_log = 0
                except Exception:
                    logger.exception(
                        "Ошибка фонового цикла очистки просроченных блокировок",
                    )
        except asyncio.CancelledError:
            raise

    async def _cleanup_once(self) -> int:
        """Выполняет один UPDATE на снятие просроченных блокировок.

        :return: количество затронутых строк (распарсенный command-tag
            ``UPDATE N`` от asyncpg). При ошибке парсинга — 0.
        """
        adapter = get_adapter()
        acts_table = adapter.get_table_name("acts")
        async with get_db() as conn:
            result = await conn.execute(
                f"""
                UPDATE {acts_table}
                SET locked_by = NULL,
                    locked_at = NULL,
                    lock_expires_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lock_expires_at <= CURRENT_TIMESTAMP
                  AND locked_by IS NOT NULL
                """,
            )
        # asyncpg возвращает строку вида ``UPDATE 3``.
        try:
            return int(result.rsplit(" ", 1)[-1])
        except (ValueError, AttributeError):
            return 0
