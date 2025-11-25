"""
Управление подключением к БД для extractors.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg
from app.core.config import get_settings


@asynccontextmanager
async def get_extractor_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    """
    Создает одноразовое подключение к БД для извлечения данных.

    Yields:
        Подключение к PostgreSQL
    """
    settings = get_settings()

    conn = await asyncpg.connect(
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        user=settings.db_user,
        password=settings.db_password
    )

    try:
        yield conn
    finally:
        await conn.close()
