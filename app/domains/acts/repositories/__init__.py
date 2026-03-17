"""Репозитории домена актов."""

from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.repositories.act_invoice import ActInvoiceRepository

__all__ = [
    "ActCrudRepository",
    "ActLockRepository",
    "ActAccessRepository",
    "ActContentRepository",
    "ActInvoiceRepository",
]
