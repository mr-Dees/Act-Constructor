"""
Управление подключением к базе данных с поддержкой PostgreSQL и Greenplum.
"""

import asyncio
import logging
import re
import subprocess as _subprocess
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg
from asyncpg import Pool

from app.core.config import Settings
from app.db.adapters.base import DatabaseAdapter
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter

logger = logging.getLogger("audit_workstation.db.connect")

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


def _is_kerberos_ticket_valid() -> bool:
    """
    Проверяет наличие действующего (не истёкшего) Kerberos билета через klist -s.

    Returns:
        True если билет валиден, или если проверка невозможна (klist не найден)
    """
    try:
        result = _subprocess.run(
            ["klist", "-s"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, _subprocess.TimeoutExpired):
        # klist недоступен или зависает — не блокируем запуск
        return True


def _log_kerberos_instructions() -> None:
    """Печатает в лог стандартную инструкцию по обновлению Kerberos билета."""
    logger.error(
        "\n" + "=" * 80 + "\n"
        "ОШИБКА: Kerberos билет отсутствует или истёк!\n"
        "=" * 80 + "\n"
        "Для продолжения работы выполните в терминале:\n\n"
        "    kinit\n\n"
        "После ввода пароля перезапустите приложение.\n"
        "=" * 80
    )


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


def make_adapter(settings: Settings) -> tuple[DatabaseAdapter, dict]:
    """
    Создаёт адаптер по типу БД и формирует pool_kwargs для asyncpg.

    Чистая функция: не открывает пул и не пишет в глобалы.

    Args:
        settings: Настройки приложения

    Returns:
        Кортеж (adapter, pool_kwargs) для последующего вызова open_pool

    Raises:
        ValueError: Если тип БД не поддерживается или не удалось извлечь
            username для Greenplum
    """
    db_type = settings.database.type

    if db_type == "postgresql":
        adapter: DatabaseAdapter = PostgreSQLAdapter(
            table_prefix=settings.database.table_prefix
        )
        pool_kwargs = dict(
            host=settings.database.host,
            port=settings.database.port,
            database=settings.database.name,
            user=settings.database.user,
            password=settings.database.password.get_secret_value(),
        )
        logger.info(
            f"Инициализация PostgreSQL: "
            f"{settings.database.host}:{settings.database.port}/{settings.database.name}"
        )
        return adapter, pool_kwargs

    if db_type == "greenplum":
        adapter = GreenplumAdapter(
            schema=settings.database.gp.schema_name,
            table_prefix=settings.database.table_prefix
        )
        # username из settings (Pydantic читает JUPYTERHUB_USER из env-shell и .env)
        username = settings.jupyterhub_user
        username_digits = re.sub(r'\D', '', username.split('_')[0])
        if not username_digits:
            raise ValueError(
                f"Не удалось извлечь username для Greenplum: {username}"
            )
        pool_kwargs = dict(
            host=settings.database.gp.host,
            port=settings.database.gp.port,
            database=settings.database.gp.database,
            user=username_digits,
        )
        logger.info(
            f"Инициализация Greenplum: "
            f"{settings.database.gp.host}:{settings.database.gp.port}/{settings.database.gp.database}, "
            f"schema={settings.database.gp.schema_name}, user={username_digits}"
        )
        return adapter, pool_kwargs

    raise ValueError(f"Неподдерживаемый тип БД: {db_type}")


async def open_pool(
    settings: Settings,
    adapter: DatabaseAdapter,
    pool_kwargs: dict,
) -> Pool:
    """
    Открывает asyncpg.Pool с обработкой Kerberos-ошибок.

    Не сохраняет результат в глобалы — это делает init_db.

    Args:
        settings: Настройки приложения (для типа БД и параметров пула)
        adapter: Адаптер (используется для определения типа БД, например GP-ветка)
        pool_kwargs: Параметры подключения от make_adapter

    Returns:
        Открытый пул подключений

    Raises:
        KerberosTokenExpiredError: Если Kerberos билет отсутствует/истёк
        RuntimeError: При прочих ошибках подключения
    """
    is_greenplum = isinstance(adapter, GreenplumAdapter)

    # Pre-flight Kerberos check для Greenplum — даём понятную ошибку
    if is_greenplum and not _is_kerberos_ticket_valid():
        _log_kerberos_instructions()
        raise KerberosTokenExpiredError(
            "Kerberos билет отсутствует или истёк. Выполните 'kinit' для обновления."
        )

    try:
        pool = await asyncpg.create_pool(
            **pool_kwargs,
            min_size=settings.database.pool_min_size,
            max_size=settings.database.pool_max_size,
            command_timeout=settings.database.command_timeout,
        )
    except asyncpg.PostgresError as e:
        error_message = str(e)
        if _is_kerberos_token_expired(error_message):
            _log_kerberos_instructions()
            raise KerberosTokenExpiredError(
                "Kerberos токен протух. Выполните 'kinit' для обновления."
            ) from e
        logger.error(f"Ошибка PostgreSQL при создании пула: {e}")
        raise RuntimeError(f"Не удалось подключиться к БД: {e}") from e
    except Exception as e:
        # Для Greenplum: OSError / ConnectionRefused часто означает протухший билет
        if is_greenplum and not _is_kerberos_ticket_valid():
            _log_kerberos_instructions()
            raise KerberosTokenExpiredError(
                "Kerberos билет отсутствует или истёк. Выполните 'kinit' для обновления."
            ) from e
        logger.error(f"Неожиданная ошибка при создании пула: {e}")
        raise RuntimeError(f"Не удалось создать пул подключений: {e}") from e

    logger.info(
        f"Database pool создан для {settings.database.type} "
        f"(min={settings.database.pool_min_size}, max={settings.database.pool_max_size})"
    )
    return pool


async def init_db(settings: Settings) -> None:
    """
    Инициализирует пул подключений и адаптер для выбранной СУБД.

    Тонкий координатор: вызывает make_adapter, open_pool, сохраняет в глобалы.

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

    adapter, pool_kwargs = make_adapter(settings)
    pool = await open_pool(settings, adapter, pool_kwargs)

    _adapter = adapter
    _pool = pool


async def warmup_pool(pool: Pool, count: int) -> None:
    """
    Открывает count соединений предзаранее для устранения TCP-handshake-задержки.

    asyncpg.Pool создаётся лениво — первый acquire() делает handshake. При старте
    приложения это означает, что первые N запросов будут на 50-200мс медленнее.
    Прогрев выполняет N холостых acquire() параллельно (с SELECT 1), после чего
    соединения возвращаются в пул и готовы к использованию.

    Args:
        pool: Открытый asyncpg.Pool
        count: Количество соединений для прогрева
    """
    if count <= 0:
        return

    async def _noop() -> None:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")

    started = time.perf_counter()
    await asyncio.gather(*(_noop() for _ in range(count)))
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    logger.info(f"Прогрев пула: {count} соединений за {elapsed_ms:.1f}мс")


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


async def create_tables_if_not_exist(domains=None) -> None:
    """
    Создаёт таблицы если их нет, используя адаптер текущей СУБД.

    Args:
        domains: Список DomainDescriptor для поиска schema.sql

    Raises:
        KerberosTokenExpiredError: Если токен протух во время создания таблиц
    """
    from app.db.adapters.postgresql import PostgreSQLAdapter

    pool = get_pool()
    adapter = get_adapter()
    db_type = "postgresql" if isinstance(adapter, PostgreSQLAdapter) else "greenplum"

    substitutions = {}
    schema_paths = []
    if domains:
        for d in domains:
            substitutions.update(d.migration_substitutions)
            if d.package_path:
                path = d.package_path / "migrations" / db_type / "schema.sql"
                if path.exists():
                    schema_paths.append(path)

    try:
        async with pool.acquire() as conn:
            await adapter.create_tables(conn, schema_paths, substitutions)

        logger.info(
            f"Схема БД ({adapter.__class__.__name__}): "
            f"целостность проверена для {len(schema_paths)} доменов"
        )

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
