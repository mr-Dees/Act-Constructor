"""
DI-зависимости для сервисов администрирования.

Предоставляет get_admin_service для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.admin.services.admin_service import AdminService
from app.domains.admin.services.http_metrics_service import HttpMetricsService
from app.domains.admin.settings import AdminSettings


def _get_admin_settings() -> AdminSettings:
    return get_domain_settings("admin", AdminSettings)


async def get_admin_service() -> AsyncGenerator[AdminService, None]:
    """Создаёт AdminService с подключением из пула."""
    async with get_db() as conn:
        yield AdminService(conn=conn, settings=_get_admin_settings())


def get_http_metrics_service() -> HttpMetricsService:
    """Возвращает сервис записи HTTP-метрик (без управления соединением).

    Сервис сам открывает короткое соединение из пула на каждый ``record()``
    — это согласуется с типичной частотой запросов и не удерживает
    соединение во время обработки.
    """
    return HttpMetricsService()
