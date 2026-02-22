"""
Базовый репозиторий с общей инфраструктурой доступа к БД.
"""

import asyncpg

from app.db.connection import get_adapter


class BaseRepository:
    """Базовый класс репозиториев: инкапсулирует соединение и адаптер."""

    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn
        self.adapter = get_adapter()
