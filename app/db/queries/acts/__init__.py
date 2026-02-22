"""
SQL-запросы домена актов.
"""

from app.db.queries.acts.act_filters import ActFilters
from app.db.queries.acts.act_queries import ActQueries

__all__ = [
    "ActQueries",
    "ActFilters",
]
