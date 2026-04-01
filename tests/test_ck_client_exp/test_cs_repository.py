"""Тесты для CSValidationRepository."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import date

from app.domains.ck_client_exp.repositories.cs_validation_repository import (
    CSValidationRepository,
)


@pytest.fixture
def mock_conn():
    """Mock asyncpg.Connection с транзакционным контекст-менеджером."""
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
def repo(mock_conn):
    """Создаёт CSValidationRepository с замоканным адаптером и соединением."""
    mock_adapter = MagicMock()
    mock_adapter.get_table_name = lambda name: name
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        return CSValidationRepository(conn=mock_conn)


# -------------------------------------------------------------------------
# search
# -------------------------------------------------------------------------


class TestSearch:

    async def test_no_filters(self, repo, mock_conn):
        """Без фильтров: нет WHERE, есть ORDER BY id DESC."""
        mock_conn.fetch.return_value = []
        await repo.search()

        query = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in query
        assert "ORDER BY id DESC" in query

    async def test_with_metric_codes(self, repo, mock_conn):
        """Фильтр по кодам метрик: metric_code IN (...)."""
        mock_conn.fetch.return_value = []
        await repo.search(metric_code=["CS-001", "CS-002"])

        query = mock_conn.fetch.call_args[0][0]
        assert "metric_code IN" in query

    async def test_with_date_range(self, repo, mock_conn):
        """Фильтр по диапазону дат: dt_sz >= $1 AND dt_sz <= $2."""
        mock_conn.fetch.return_value = []
        await repo.search(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )

        query = mock_conn.fetch.call_args[0][0]
        assert "dt_sz >= $1" in query
        assert "dt_sz <= $2" in query

    async def test_with_process_codes(self, repo, mock_conn):
        """Фильтр по кодам процессов: process_number IN (...)."""
        mock_conn.fetch.return_value = []
        await repo.search(process_code=["2050", "3010"])

        query = mock_conn.fetch.call_args[0][0]
        assert "process_number IN" in query


# -------------------------------------------------------------------------
# get_by_id
# -------------------------------------------------------------------------


class TestGetById:

    async def test_found(self, repo, mock_conn):
        """Возвращает словарь с metric_unic_clients, если запись найдена."""
        mock_conn.fetchrow.return_value = {
            "id": 1,
            "metric_code": "CS-001",
            "metric_unic_clients": 150,
        }
        result = await repo.get_by_id(1)

        assert result is not None
        assert result["id"] == 1
        assert result["metric_code"] == "CS-001"
        assert result["metric_unic_clients"] == 150

    async def test_not_found(self, repo, mock_conn):
        """Возвращает None, если запись не найдена."""
        mock_conn.fetchrow.return_value = None
        result = await repo.get_by_id(999)

        assert result is None


# -------------------------------------------------------------------------
# soft_delete
# -------------------------------------------------------------------------


class TestSoftDelete:

    async def test_success(self, repo, mock_conn):
        """Возвращает True при успешном удалении (UPDATE 1)."""
        mock_conn.execute.return_value = "UPDATE 1"
        result = await repo.soft_delete(record_id=1, username="testuser")

        assert result is True

    async def test_failure(self, repo, mock_conn):
        """Возвращает False, если запись не найдена (UPDATE 0)."""
        mock_conn.execute.return_value = "UPDATE 0"
        result = await repo.soft_delete(record_id=999, username="testuser")

        assert result is False
