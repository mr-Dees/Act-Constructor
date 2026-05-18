"""Сервис-фасад для записи HTTP-метрик.

Любой сбой записи (сетевая ошибка БД, отсутствие таблицы, и т.п.) глушится
с warning-логом: метрика — вспомогательный наблюдательный сигнал и не
должна ломать основной запрос.
"""

from __future__ import annotations

import logging

from app.db.connection import get_db
from app.domains.admin.repositories.http_metrics_repository import (
    HttpMetricsRepository,
)

logger = logging.getLogger("audit_workstation.domains.admin.service.http_metrics")


class HttpMetricsService:
    """Запись HTTP-метрик с проглатыванием ошибок."""

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
