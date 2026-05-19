"""Батчер записи аудит-лога актов.

Накапливает ``ActAuditLogRecord`` и периодически сбрасывает пакетом через
``ActAuditLogRepository.log_many``. Сокращает число одиночных INSERT'ов на
Greenplum при высокой частоте действий пользователя (save_content, lock,
unlock, duplicate, ...).

Тонкая обёртка над generic ``MetricsBatcher``: фиксирует тип записи и
определяет flush-callback, который берёт свежий коннект из пула и пишет
пакет в одну транзакцию.

Параметры по умолчанию выбраны под доменный сценарий (десятки операций
в минуту, допустимо потерять до ``batch_size`` записей при крэше):

* ``batch_size = 50`` — компромисс между латентностью и нагрузкой на GP.
* ``flush_interval_sec = 30.0`` — типичная сессия пользователя в редакторе.
"""

from __future__ import annotations

from app.core.metrics_batcher import MetricsBatcher
from app.db.connection import get_db
from app.domains.acts.repositories.act_audit_log import (
    ActAuditLogRecord,
    ActAuditLogRepository,
)


class ActAuditLogBatcher(MetricsBatcher[ActAuditLogRecord]):
    """Батчер записи ``ActAuditLogRecord`` в БД пакетами."""

    def __init__(
        self,
        *,
        batch_size: int = 50,
        flush_interval_sec: float = 30.0,
        max_buffer_size: int = 5000,
        name: str = "acts_audit_log",
    ):
        super().__init__(
            flush_callback=self._flush_records,
            max_batch_size=batch_size,
            flush_interval_sec=flush_interval_sec,
            max_buffer_size=max_buffer_size,
            name=name,
        )

    @staticmethod
    async def _flush_records(records: list[ActAuditLogRecord]) -> None:
        """Сбрасывает пакет записей в БД через ``log_many``.

        Берёт коннект из пула на время bulk-INSERT'а и сразу освобождает.
        Исключения логирует ``MetricsBatcher._flush_locked``.
        """
        async with get_db() as conn:
            await ActAuditLogRepository(conn).log_many(records)
