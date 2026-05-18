"""Сервис-фасад для записи HTTP-метрик.

Любой сбой записи (сетевая ошибка БД, отсутствие таблицы, и т.п.) глушится
с warning-логом: метрика — вспомогательный наблюдательный сигнал и не
должна ломать основной запрос.

Если в конструктор передан ``batcher`` — запись идёт в него (отложенный
bulk-INSERT). Иначе fallback на синхронную запись (legacy-путь, используется
тестами и при отсутствии lifespan-инициализации батчера).
"""

from __future__ import annotations

import logging

from app.core.metrics_batcher import MetricsBatcher
from app.db.connection import get_db
from app.domains.admin.repositories.http_metrics_repository import (
    HttpMetricRecord,
    HttpMetricsRepository,
)

logger = logging.getLogger("audit_workstation.domains.admin.service.http_metrics")


class HttpMetricsService:
    """Запись HTTP-метрик с проглатыванием ошибок."""

    def __init__(
        self,
        batcher: MetricsBatcher[HttpMetricRecord] | None = None,
    ):
        """:param batcher: батчер для отложенной записи. Если None — синхронный путь."""
        self._batcher = batcher

    def _resolve_batcher(self):
        """Возвращает активный батчер — переданный в конструктор ИЛИ из deps.

        Сервис создаётся при ``create_app`` ДО lifespan, поэтому батчер,
        выставленный в lifespan, может появиться позже. Чтобы не привязываться
        к моменту создания, на каждый ``record()`` смотрим текущее значение.
        """
        if self._batcher is not None:
            return self._batcher
        try:
            from app.domains.admin.deps import get_http_metrics_batcher
            return get_http_metrics_batcher()
        except Exception:
            return None

    async def record(
        self,
        method: str,
        path: str,
        status_code: int,
        latency_ms: int,
        username: str | None,
        request_id: str | None,
    ) -> None:
        """Записывает HTTP-метрику. Любое исключение логируется и не пробрасывается."""
        try:
            batcher = self._resolve_batcher()
            if batcher is not None:
                await batcher.add(
                    HttpMetricRecord(
                        method=method,
                        path=path,
                        status_code=int(status_code),
                        latency_ms=int(latency_ms),
                        username=username,
                        request_id=request_id,
                    )
                )
                return
            # Legacy-путь: открываем соединение и пишем единичную запись.
            async with get_db() as conn:
                repo = HttpMetricsRepository(conn=conn)
                await repo.record(
                    method=method,
                    path=path,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    username=username,
                    request_id=request_id,
                )
        except Exception:
            logger.warning(
                "Не удалось записать HTTP-метрику",
                extra={
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                },
            )
