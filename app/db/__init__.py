"""
Инфраструктура доступа к PostgreSQL.

Содержит:
- функции инициализации и управления пулом подключений
- контекстный менеджер для получения соединения
- вспомогательную функцию создания схемы БД при старте
"""

from app.db.connection import (
    get_pool,
    init_db,
    close_db,
    get_db,
    get_db_connection,
    create_tables_if_not_exist,
)

__all__ = [
    "get_pool",
    "init_db",
    "close_db",
    "get_db",
    "get_db_connection",
    "create_tables_if_not_exist",
]
