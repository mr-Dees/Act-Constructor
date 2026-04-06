"""Общие фикстуры для тестов."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_conn():
    """Mock asyncpg.Connection для unit-тестов репозиториев."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock()
    conn.fetchval = AsyncMock()
    conn.fetch = AsyncMock()
    conn.execute = AsyncMock()
    conn.executemany = AsyncMock()

    # Mock менеджера транзакций
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)

    return conn


@pytest.fixture
def mock_adapter():
    """Mock DatabaseAdapter для unit-тестов."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    adapter.supports_on_conflict = MagicMock(return_value=True)
    return adapter
