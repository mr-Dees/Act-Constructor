"""
Database adapters для поддержки различных СУБД.
"""

from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter

__all__ = [
    "DatabaseAdapter",
    "PostgreSQLAdapter",
    "GreenplumAdapter",
]
