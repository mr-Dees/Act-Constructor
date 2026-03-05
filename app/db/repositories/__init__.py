"""
Репозитории доступа к данным.

Re-exports из доменных подпакетов.
"""

from app.db.repositories.acts import (
    ActCrudRepository,
    ActLockRepository,
    ActAccessRepository,
    ActInvoiceRepository,
)

from app.db.connection import (
    get_pool,
    init_db,
    close_db,
    get_db,
    create_tables_if_not_exist,
)

__all__ = [
    "get_pool",
    "init_db",
    "close_db",
    "get_db",
    "create_tables_if_not_exist",
    "ActCrudRepository",
    "ActLockRepository",
    "ActAccessRepository",
    "ActInvoiceRepository",
]
