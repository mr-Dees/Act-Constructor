"""
Инфраструктура доступа к PostgreSQL и бизнес-логика работы с актами.

Содержит:
- функции инициализации и управления пулом подключений
- контекстный менеджер для получения соединения
- вспомогательную функцию создания схемы БД
- высокоуровневый сервис ActDBService
- классы запросов ActQueries и фильтров ActFilters
"""

from app.db.repositories.act_repository import ActDBService

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
    "ActDBService",
    "ActQueries",
    "ActFilters",
]
