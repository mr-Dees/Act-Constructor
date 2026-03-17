"""
DI-зависимости для сервисов актов.

Предоставляет get_*_service для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from fastapi import Depends

from app.core.config import get_settings, Settings
from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.acts.services.act_crud_service import ActCrudService
from app.domains.acts.services.act_lock_service import ActLockService
from app.domains.acts.services.act_content_service import ActContentService
from app.domains.acts.services.act_invoice_service import ActInvoiceService
from app.domains.acts.settings import ActsSettings


def _get_acts_settings() -> ActsSettings:
    return get_domain_settings("acts", ActsSettings)


async def get_crud_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActCrudService, None]:
    """Создает ActCrudService с подключением из пула."""
    async with get_db() as conn:
        yield ActCrudService(conn=conn, settings=settings)


async def get_lock_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActLockService, None]:
    """Создает ActLockService с подключением из пула."""
    async with get_db() as conn:
        yield ActLockService(conn=conn, settings=settings, acts_settings=_get_acts_settings())


async def get_content_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActContentService, None]:
    """Создает ActContentService с подключением из пула."""
    async with get_db() as conn:
        yield ActContentService(conn=conn, settings=settings)


async def get_invoice_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActInvoiceService, None]:
    """Создает ActInvoiceService с подключением из пула."""
    async with get_db() as conn:
        yield ActInvoiceService(conn=conn, settings=settings, acts_settings=_get_acts_settings())
