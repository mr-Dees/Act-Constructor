"""Тесты разделения init_db на make_adapter / open_pool / init_db и warmup_pool."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.db import connection
from app.db.adapters.greenplum import GreenplumAdapter
from app.db.adapters.postgresql import PostgreSQLAdapter
from app.db.connection import make_adapter, warmup_pool


@pytest.fixture(autouse=True)
def reset_connection_globals():
    """Сбрасывает глобальное состояние _pool и _adapter между тестами."""
    yield
    connection._pool = None
    connection._adapter = None


def _make_settings(db_type="postgresql", jupyterhub_user="12345_user"):
    """Минимальный mock-объект Settings."""
    s = MagicMock()
    s.database.type = db_type
    s.database.host = "localhost"
    s.database.port = 5432
    s.database.name = "testdb"
    s.database.user = "testuser"
    s.database.password = MagicMock(get_secret_value=MagicMock(return_value="secret"))
    s.database.pool_min_size = 1
    s.database.pool_max_size = 5
    s.database.command_timeout = 30
    s.database.gp.host = "gp-host"
    s.database.gp.port = 5433
    s.database.gp.database = "gpdb"
    s.database.gp.schema_name = "test_schema"
    s.database.table_prefix = "t_prefix_"
    s.jupyterhub_user = jupyterhub_user
    return s


# ---------------------------------------------------------------------------
# make_adapter
# ---------------------------------------------------------------------------


def test_make_adapter_postgresql():
    """PostgreSQL: адаптер + полный набор kwargs для asyncpg.create_pool."""
    settings = _make_settings(db_type="postgresql")
    adapter, pool_kwargs = make_adapter(settings)

    assert isinstance(adapter, PostgreSQLAdapter)
    assert pool_kwargs == {
        "host": "localhost",
        "port": 5432,
        "database": "testdb",
        "user": "testuser",
        "password": "secret",
    }


def test_make_adapter_greenplum_extracts_user():
    """Greenplum: username из jupyterhub_user — только цифры из первой части."""
    settings = _make_settings(db_type="greenplum", jupyterhub_user="u12345_dev")
    adapter, pool_kwargs = make_adapter(settings)

    assert isinstance(adapter, GreenplumAdapter)
    assert pool_kwargs["user"] == "12345"
    assert pool_kwargs["host"] == "gp-host"
    assert pool_kwargs["port"] == 5433
    assert pool_kwargs["database"] == "gpdb"
    # Greenplum-pool_kwargs не должен содержать пароль (Kerberos)
    assert "password" not in pool_kwargs


def test_make_adapter_greenplum_username_without_digits_raises():
    """Greenplum: если username без цифр — ValueError."""
    settings = _make_settings(db_type="greenplum", jupyterhub_user="no_digits_here")
    with pytest.raises(ValueError, match="Не удалось извлечь username"):
        make_adapter(settings)


def test_make_adapter_invalid_type_raises_value_error():
    """Неподдерживаемый тип БД → ValueError."""
    settings = _make_settings(db_type="oracle")
    with pytest.raises(ValueError, match="Неподдерживаемый тип БД"):
        make_adapter(settings)


# ---------------------------------------------------------------------------
# warmup_pool
# ---------------------------------------------------------------------------


async def test_warmup_pool_acquires_count_connections():
    """warmup_pool должен сделать N acquire() и на каждом — SELECT 1."""
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=1)

    mock_pool = MagicMock()
    acquire_cm = MagicMock()
    acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
    acquire_cm.__aexit__ = AsyncMock(return_value=False)
    mock_pool.acquire = MagicMock(return_value=acquire_cm)

    await warmup_pool(mock_pool, count=4)

    assert mock_pool.acquire.call_count == 4
    assert mock_conn.fetchval.await_count == 4
    mock_conn.fetchval.assert_awaited_with("SELECT 1")


async def test_warmup_pool_zero_count_noop():
    """count=0 — никакого acquire не делается."""
    mock_pool = MagicMock()
    mock_pool.acquire = MagicMock()
    await warmup_pool(mock_pool, count=0)
    mock_pool.acquire.assert_not_called()
