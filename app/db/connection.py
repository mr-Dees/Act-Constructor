"""
Управление подключением к базе данных с поддержкой PostgreSQL и Greenplum.
"""

import logging
import os
import re
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


class KerberosTokenExpiredError(Exception):
    """Исключение для протухшего Kerberos токена."""
    pass


def _is_kerberos_token_expired(error_message: str) -> bool:
    """
    Проверяет, является ли ошибка протухшим Kerberos токеном.

    Args:
        error_message: Текст ошибки от asyncpg

    Returns:
        True если токен протух
    """
    error_lower = error_message.lower()

    # Различные варианты формулировок ошибки Kerberos
    kerberos_patterns = [
        "ticket expired",
        "tkt_expired",
        "krb_ap_err_tkt_expired",
        "gss failure",
        "gss error",
        "unspecified gss failure",
        "credentials cache",
        "credential cache file",
        "no kerberos credentials available",
        "kerberos credentials",
        "kinit",
        "authentification",  # опечатка в вашем сообщении
        "authentication",
        "minor: ticket expired",  # точное совпадение из вашей ошибки
    ]

    return any(pattern in error_lower for pattern in kerberos_patterns)


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

    Raises:
        KerberosTokenExpiredError: Если Kerberos токен протух
        ValueError: Если неверный тип БД или параметры
        RuntimeError: При других ошибках подключения
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
        try:
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

        except asyncpg.PostgresError as e:
            error_message = str(e)

            # Проверяем протухший токен Kerberos
            if _is_kerberos_token_expired(error_message):
                logger.error(
                    "=" * 80 + "\n"
                               "ОШИБКА: Kerberos токен авторизации протух!\n"
                               "=" * 80 + "\n"
                                          "Для продолжения работы выполните в терминале команду:\n\n"
                                          "    kinit\n\n"
                                          "После ввода пароля токен будет обновлен и приложение\n"
                                          "сможет подключиться к базе данных.\n"
                                          "=" * 80 + "\n"
                                                     f"Детали ошибки: {error_message}\n"
                                                     "=" * 80
                )
                raise KerberosTokenExpiredError(
                    "Kerberos токен протух. Выполните 'kinit' для обновления."
                ) from e

            # Прокидываем другие ошибки PostgreSQL
            logger.error(f"Ошибка PostgreSQL при создании пула: {e}")
            raise RuntimeError(f"Не удалось подключиться к БД: {e}") from e

        except Exception as e:
            logger.error(f"Неожиданная ошибка при создании пула: {e}")
            raise RuntimeError(f"Не удалось создать пул подключений: {e}") from e

    except KerberosTokenExpiredError:
        # Пробрасываем Kerberos ошибку без изменений
        raise
    except ValueError as e:
        # Пробрасываем ошибки валидации
        logger.error(f"Ошибка конфигурации БД: {e}")
        raise
    except Exception as e:
        logger.exception(f"Неожиданная ошибка инициализации БД: {e}")
        raise RuntimeError(f"Не удалось инициализировать БД: {e}") from e


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
        KerberosTokenExpiredError: Если токен протух во время работы
        RuntimeError: Если пул не инициализирован
    """
    pool = get_pool()

    try:
        async with pool.acquire() as connection:
            yield connection
    except asyncpg.PostgresError as e:
        error_message = str(e)

        if _is_kerberos_token_expired(error_message):
            logger.error(
                "Kerberos токен протух во время выполнения запроса. "
                "Выполните 'kinit' для обновления."
            )
            raise KerberosTokenExpiredError(
                "Kerberos токен протух. Выполните 'kinit' для обновления."
            ) from e

        # Прокидываем другие ошибки дальше
        raise


async def get_db_connection() -> asyncpg.Connection:
    """
    Альтернативный метод получения подключения (без context manager).

    Returns:
        Подключение из пула

    Raises:
        KerberosTokenExpiredError: Если токен протух
        RuntimeError: Если пул не инициализирован

    Note:
        Вызывающий код должен сам закрыть подключение через conn.close()
    """
    pool = get_pool()

    try:
        return await pool.acquire()
    except asyncpg.PostgresError as e:
        error_message = str(e)

        if _is_kerberos_token_expired(error_message):
            logger.error(
                "Kerberos токен протух при получении подключения. "
                "Выполните 'kinit' для обновления."
            )
            raise KerberosTokenExpiredError(
                "Kerberos токен протух. Выполните 'kinit' для обновления."
            ) from e

        raise


async def create_tables_if_not_exist() -> None:
    """
    Создаёт таблицы если их нет, используя адаптер текущей СУБД.

    Raises:
        KerberosTokenExpiredError: Если токен протух во время создания таблиц
    """
    pool = get_pool()
    adapter = get_adapter()

    try:
        async with pool.acquire() as conn:
            await adapter.create_tables(conn)

        logger.info(
            f"Схема БД ({adapter.__class__.__name__}) создана/проверена успешно"
        )

    except asyncpg.DuplicateObjectError as e:
        logger.warning(f"Некоторые объекты БД уже существуют: {e}")
        logger.info("Схема БД проверена")

    except asyncpg.PostgresError as e:
        error_message = str(e)

        if _is_kerberos_token_expired(error_message):
            logger.error(
                "Kerberos токен протух при создании таблиц. "
                "Выполните 'kinit' для обновления."
            )
            raise KerberosTokenExpiredError(
                "Kerberos токен протух. Выполните 'kinit' для обновления."
            ) from e

        logger.exception(f"Ошибка PostgreSQL при создании схемы БД: {e}")
        raise

    except Exception as e:
        logger.exception(f"Неожиданная ошибка создания схемы БД: {e}")
        raise
