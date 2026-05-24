"""Фоновая задача очистки устаревших agent_response_events.

Каждые ``interval_sec`` секунд выполняет

    DELETE FROM {agent_response_events}
    WHERE request_id IN (
        SELECT id FROM {agent_requests}
        WHERE status = 'done' AND finished_at < NOW() - $1::interval
    )

Без этого таблица растёт безгранично: каждый forward пишет N reasoning'ов
(часто десятки), и после done они не нужны — финальный response уже
сохранён в ``chat_messages.content`` через инкрементальную запись Phase 1.

Опирается на индекс ``idx_{PREFIX}agent_requests_status`` (есть в обеих
схемах). Раз в час (или каждые ``log_every_n_cycles`` тиков) пишет
суммарную статистику в INFO-лог.
"""

from __future__ import annotations

import asyncio
import logging

from app.db.connection import get_adapter, get_db

logger = logging.getLogger(
    "audit_workstation.domains.chat.agent_events_cleanup",
)


class AgentEventsCleanupTask:
    """Asyncio-задача, периодически удаляющая устаревшие agent events."""

    def __init__(
        self,
        *,
        interval_sec: float = 3600.0,
        ttl_hours: int = 24,
        log_every_n_cycles: int = 1,
    ):
        """
        :param interval_sec: период вызова DELETE (1 час по дефолту).
        :param ttl_hours: события для done-запросов старше этого
            возраста удаляются. 24 часа — достаточно для отладочного
            доступа к старым reasoning'ам.
        :param log_every_n_cycles: каждые ``N`` циклов писать суммарную
            статистику в INFO-лог. По дефолту 1 (каждый цикл).
        """
        self._interval_sec = interval_sec
        self._ttl_hours = ttl_hours
        self._log_every_n_cycles = max(1, log_every_n_cycles)
        self._task: asyncio.Task | None = None
        self._shutdown = False
        # Аккумуляторы статистики между INFO-логами.
        self._cycles_since_log = 0
        self._deleted_since_log = 0

    def get_status(self) -> dict:
        """Снимок состояния задачи для diagnostics-endpoint'а."""
        return {
            "name": "chat.agent_events_cleanup",
            "running": self._task is not None and not self._task.done(),
            "interval_sec": self._interval_sec,
            "ttl_hours": self._ttl_hours,
            "cycles_since_log": self._cycles_since_log,
            "deleted_since_log": self._deleted_since_log,
        }

    async def start(self) -> None:
        """Стартует фоновую задачу. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._shutdown = False
        self._task = asyncio.create_task(
            self._run(), name="chat:agent_events_cleanup",
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
                    deleted = await self._cleanup_once()
                    self._deleted_since_log += deleted
                    self._cycles_since_log += 1
                    if self._cycles_since_log >= self._log_every_n_cycles:
                        logger.info(
                            "Очистка agent_response_events: за последние "
                            "%d циклов удалено %d событий "
                            "(ttl_hours=%d)",
                            self._cycles_since_log,
                            self._deleted_since_log,
                            self._ttl_hours,
                        )
                        self._cycles_since_log = 0
                        self._deleted_since_log = 0
                except Exception:
                    logger.exception(
                        "Ошибка фонового цикла очистки "
                        "agent_response_events",
                    )
        except asyncio.CancelledError:
            raise

    async def _cleanup_once(self) -> int:
        """Выполняет один DELETE на устаревшие events.

        :return: количество удалённых строк (распарсенный command-tag
            ``DELETE N`` от asyncpg). При ошибке парсинга — 0.
        """
        adapter = get_adapter()
        events_table = adapter.get_table_name("agent_response_events")
        requests_table = adapter.get_table_name("agent_requests")
        async with get_db() as conn:
            result = await conn.execute(
                f"""
                DELETE FROM {events_table}
                WHERE request_id IN (
                    SELECT id FROM {requests_table}
                    WHERE status = 'done'
                      AND finished_at < NOW() - $1::interval
                )
                """,
                f"{self._ttl_hours} hours",
            )
        # asyncpg возвращает строку вида ``DELETE 42``.
        try:
            return int(result.rsplit(" ", 1)[-1])
        except (ValueError, AttributeError):
            return 0
