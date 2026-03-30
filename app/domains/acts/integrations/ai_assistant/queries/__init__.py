"""
SQL-запросы для AI-ассистента.

Содержит запросы и фильтры для извлечения данных актов.
"""

from app.domains.acts.integrations.ai_assistant.queries.act_queries import ActQueries
from app.domains.acts.integrations.ai_assistant.queries.act_filters import ActFilters

__all__ = [
    "ActQueries",
    "ActFilters",
]
