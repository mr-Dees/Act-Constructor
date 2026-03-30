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
    return conn


@pytest.fixture
def mock_adapter():
    """Mock DatabaseAdapter для unit-тестов."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    return adapter
