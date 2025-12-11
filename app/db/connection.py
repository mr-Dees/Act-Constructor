"""
Управление подключением к базе данных с поддержкой PostgreSQL и Greenplum.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg
from asyncpg import Pool

from app.core.config import Settings
from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter

logger = logging.getLogger("act_constructor.db.connect")

_pool: Pool | None = None
_adapter: DatabaseAdapter | None = None


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


def get_adapter() -> DatabaseAdapter:
    """
    Возвращает текущий database адаптер.

    Returns:
        Активный адаптер для работы с БД

    Raises:
        RuntimeError: Если адаптер не инициализирован
    """
    if _adapter is None:
        raise RuntimeError(
            "Database adapter не инициализирован. Вызовите init_db() сначала."
        )
    return _adapter


async def init_db(settings: Settings) -> None:
    """
    Инициализирует пул подключений и адаптер для выбранной СУБД.

    Args:
        settings: Настройки приложения с параметрами БД
    """
    global _pool, _adapter

    if _pool is not None:
        logger.warning("Database pool уже инициализирован")
        return

    try:
        # Определяем тип БД и создаем адаптер
        if settings.db_type == "postgresql":
            _adapter = PostgreSQLAdapter()

            dsn = (
                f"postgresql://{settings.db_user}:{settings.db_password}"
                f"@{settings.db_host}:{settings.db_port}/{settings.db_name}"
            )

            logger.info(
                f"Инициализация PostgreSQL: "
                f"{settings.db_host}:{settings.db_port}/{settings.db_name}"
            )

        elif settings.db_type == "greenplum":
            _adapter = GreenplumAdapter(
                schema=settings.gp_schema,
                table_prefix=settings.gp_table_prefix
            )

            # Получаем username из JUPYTERHUB_USER
            username = os.environ.get('JUPYTERHUB_USER')

            if not username or username == 'unknown_user':
                # Fallback на значение из .env для разработки
                username = settings.jupyterhub_user

            # Извлекаем только цифры из username
            import re
            username_digits = re.sub(r'\D', '', username.split('_')[0])

            if not username_digits:
                raise ValueError(
                    f"Не удалось извлечь username для Greenplum: {username}"
                )

            dsn = (
                f"postgresql://{username_digits}"
                f"@{settings.gp_host}:{settings.gp_port}/{settings.gp_database}"
            )

            logger.info(
                f"Инициализация Greenplum: "
                f"{settings.gp_host}:{settings.gp_port}/{settings.gp_database}, "
                f"schema={settings.gp_schema}, user={username_digits}"
            )

        else:
            raise ValueError(f"Неподдерживаемый тип БД: {settings.db_type}")

        # Создаем пул подключений
        _pool = await asyncpg.create_pool(
            dsn,
            min_size=settings.db_pool_min_size,
            max_size=settings.db_pool_max_size,
            command_timeout=60
        )

        logger.info(
            f"Database pool создан для {settings.db_type} "
            f"(min={settings.db_pool_min_size}, max={settings.db_pool_max_size})"
        )

    except Exception as e:
        logger.exception(f"Ошибка создания database pool: {e}")
        raise


async def close_db() -> None:
    """Закрывает пул подключений к БД."""
    global _pool, _adapter

    if _pool is not None:
        await _pool.close()
        _pool = None
        _adapter = None
        logger.info("Database pool закрыт")


@asynccontextmanager
async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """
    Dependency для получения подключения к БД.

    Yields:
        Подключение из пула

    Raises:
        RuntimeError: Если пул не инициализирован
    """
    pool = get_pool()

    async with pool.acquire() as connection:
        yield connection


async def get_db_connection() -> asyncpg.Connection:
    """
    Альтернативный метод получения подключения (без context manager).

    Returns:
        Подключение из пула

    Note:
        Вызывающий код должен сам закрыть подключение через conn.close()
    """
    pool = get_pool()
    return await pool.acquire()


async def create_tables_if_not_exist() -> None:
    """
    Создаёт таблицы если их нет, используя адаптер текущей СУБД.
    """
    pool = get_pool()
    adapter = get_adapter()

    try:
        async with pool.acquire() as conn:
            await adapter.create_tables(conn)

        logger.info(f"Схема БД ({adapter.__class__.__name__}) создана/проверена успешно")

    except asyncpg.DuplicateObjectError as e:
        logger.warning(f"Некоторые объекты БД уже существуют: {e}")
        logger.info("Схема БД проверена")

    except Exception as e:
        logger.exception(f"Ошибка создания схемы БД: {e}")
        raise
