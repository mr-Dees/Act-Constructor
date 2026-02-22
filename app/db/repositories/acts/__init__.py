"""
Репозитории домена актов.
"""

from app.db.repositories.acts.act_crud import ActCrudRepository
from app.db.repositories.acts.act_lock import ActLockRepository
from app.db.repositories.acts.act_access import ActAccessRepository
from app.db.repositories.acts.act_invoice import ActInvoiceRepository

__all__ = [
    "ActCrudRepository",
    "ActLockRepository",
    "ActAccessRepository",
    "ActInvoiceRepository",
]
