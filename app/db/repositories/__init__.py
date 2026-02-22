"""
Репозитории доступа к данным.

Backward-compatible re-exports из доменных подпакетов.
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
    get_db_connection,
    create_tables_if_not_exist,
)
from app.db.queries import ActQueries, ActFilters

__all__ = [
    "get_pool",
    "init_db",
    "close_db",
    "get_db",
    "get_db_connection",
    "create_tables_if_not_exist",
    "ActCrudRepository",
    "ActLockRepository",
    "ActAccessRepository",
    "ActInvoiceRepository",
    "ActQueries",
    "ActFilters",
]
