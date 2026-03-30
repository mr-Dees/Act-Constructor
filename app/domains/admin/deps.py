"""
DI-зависимости для сервисов администрирования.

Предоставляет get_admin_service для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.admin.services.admin_service import AdminService
from app.domains.admin.settings import AdminSettings


def _get_admin_settings() -> AdminSettings:
    return get_domain_settings("admin", AdminSettings)


async def get_admin_service() -> AsyncGenerator[AdminService, None]:
    """Создаёт AdminService с подключением из пула."""
    async with get_db() as conn:
        yield AdminService(conn=conn, settings=_get_admin_settings())
