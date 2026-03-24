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
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.repositories.act_content_version import ActContentVersionRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.services.access_guard import AccessGuard
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
        yield ActContentService(conn=conn, settings=settings, acts_settings=_get_acts_settings())


async def get_invoice_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActInvoiceService, None]:
    """Создает ActInvoiceService с подключением из пула."""
    async with get_db() as conn:
        yield ActInvoiceService(conn=conn, settings=settings, acts_settings=_get_acts_settings())


async def get_audit_log_deps() -> AsyncGenerator[tuple[AccessGuard, ActAuditLogRepository, ActContentVersionRepository], None]:
    """Создает зависимости для аудит-лога: guard + репозитории."""
    async with get_db() as conn:
        access = ActAccessRepository(conn)
        lock = ActLockRepository(conn)
        guard = AccessGuard(access, lock)
        audit_repo = ActAuditLogRepository(conn)
        versions_repo = ActContentVersionRepository(conn)
        yield guard, audit_repo, versions_repo


async def get_audit_log_service() -> AsyncGenerator:
    """Создает AuditLogService с подключением из пула."""
    from app.domains.acts.services.audit_log_service import AuditLogService

    async with get_db() as conn:
        access = ActAccessRepository(conn)
        lock = ActLockRepository(conn)
        guard = AccessGuard(access, lock)
        audit_repo = ActAuditLogRepository(conn)
        versions_repo = ActContentVersionRepository(conn)
        yield AuditLogService(guard, audit_repo, versions_repo, conn)
