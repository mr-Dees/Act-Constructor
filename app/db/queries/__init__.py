"""
SQL-запросы к базе данных актов.

Содержит:
- ActQueries: извлечение метаданных, дерева структуры, таблиц,
  текстовых блоков и нарушений, а также навигацию по иерархии
- ActFilters: построение запросов поиска актов по метаданным и
  форматирование результатов поиска
"""

from app.db.queries.act_filters import ActFilters
from app.db.queries.act_queries import ActQueries

__all__ = [
    "ActQueries",
    "ActFilters",
]
