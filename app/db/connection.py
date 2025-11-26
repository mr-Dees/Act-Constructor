# app/db/connection.py
"""
Управление подключением к PostgreSQL.
"""

import logging
from pathlib import Path
from typing import AsyncGenerator

import asyncpg
from asyncpg import Pool

from app.core.config import Settings

logger = logging.getLogger("act_constructor.db")

_pool: Pool | None = None


def get_pool() -> Pool:
    """
    Возвращает текущий пул подключений к БД.

    Returns:
        Активный пул подключений

    Raises:
        RuntimeError: Если пул не инициализирован
    """
    if _pool is None:
        raise RuntimeError(
            "Database pool не инициализирован. Вызовите init_db() сначала."
        )
    return _pool


async def init_db(settings: Settings) -> None:
    """
    Инициализирует пул подключений к PostgreSQL.

    Args:
        settings: Настройки приложения с параметрами БД
    """
    global _pool

    if _pool is not None:
        logger.warning("Database pool уже инициализирован")
        return

    try:
        _pool = await asyncpg.create_pool(
            host=settings.db_host,
            port=settings.db_port,
            user=settings.db_user,
            password=settings.db_password,
            database=settings.db_name,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            command_timeout=60
        )
        logger.info(
            f"Database pool создан: {settings.db_host}:{settings.db_port}/{settings.db_name}"
        )
    except Exception as e:
        logger.exception(f"Ошибка создания database pool: {e}")
        raise


async def close_db() -> None:
    """Закрывает пул подключений к БД."""
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Database pool закрыт")


async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """
    Dependency для получения подключения к БД.

    Yields:
        Подключение из пула

    Raises:
        RuntimeError: Если пул не инициализирован
    """
    pool = get_pool()  # Используем геттер

    async with pool.acquire() as connection:
        yield connection


async def create_tables_if_not_exist() -> None:
    """Создаёт таблицы если их нет."""
    pool = get_pool()  # Используем геттер

    schema_path = Path(__file__).parent / "schema.sql"

    if not schema_path.exists():
        logger.warning(f"Файл схемы не найден: {schema_path}")
        return

    try:
        schema_sql = schema_path.read_text(encoding='utf-8')

        async with pool.acquire() as conn:
            # Выполняем SQL-скрипт
            await conn.execute(schema_sql)

        logger.info("Схема БД создана/проверена успешно")

    except asyncpg.DuplicateObjectError as e:
        # Игнорируем ошибки дублирования объектов (таблицы/индексы уже существуют)
        logger.warning(f"Некоторые объекты БД уже существуют: {e}")
        logger.info("Схема БД проверена")

    except Exception as e:
        logger.exception(f"Ошибка создания схемы БД: {e}")
        raise
