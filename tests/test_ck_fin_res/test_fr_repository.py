"""Тесты для FRValidationRepository."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import date

from app.core import settings_registry
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ck_fin_res.settings import CkFinResSettings


@pytest.fixture(autouse=True)
def _reset_settings():
    """Сброс реестра настроек между тестами."""
    settings_registry.reset()
    settings_registry.register("ck_fin_res", CkFinResSettings)
    yield
    settings_registry.reset()


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
    """Создаёт FRValidationRepository с замоканным адаптером и соединением."""
    mock_adapter = MagicMock()
    mock_adapter.qualify_table_name = lambda name, schema="": name
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        return FRValidationRepository(conn=mock_conn)


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

    async def test_with_metric_codes(self, repo, mock_conn):
        """Фильтр по кодам метрик: metric_code IN (...)."""
        mock_conn.fetch.return_value = []
        await repo.search(metric_code=["FR-001", "FR-002"])

        query = mock_conn.fetch.call_args[0][0]
        assert "metric_code IN" in query

    async def test_with_all_filters(self, repo, mock_conn):
        """Все фильтры одновременно формируют корректный запрос."""
        mock_conn.fetch.return_value = []
        await repo.search(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            metric_code=["FR-001"],
            process_code=["1013"],
        )

        query = mock_conn.fetch.call_args[0][0]
        assert "dt_sz >= $1" in query
        assert "dt_sz <= $2" in query
        assert "metric_code IN" in query
        assert "process_number IN" in query


# -------------------------------------------------------------------------
# get_by_id
# -------------------------------------------------------------------------


class TestGetById:

    async def test_found(self, repo, mock_conn):
        """Возвращает словарь, если запись найдена."""
        mock_conn.fetchrow.return_value = {"id": 1, "metric_code": "FR-001"}
        result = await repo.get_by_id(1)

        assert result is not None
        assert result["id"] == 1
        assert result["metric_code"] == "FR-001"

    async def test_not_found(self, repo, mock_conn):
        """Возвращает None, если запись не найдена."""
        mock_conn.fetchrow.return_value = None
        result = await repo.get_by_id(999)

        assert result is None


# -------------------------------------------------------------------------
# create
# -------------------------------------------------------------------------


class TestCreate:

    async def test_returns_id(self, repo, mock_conn):
        """Возвращает словарь с id и created_at после вставки."""
        mock_conn.fetchrow.return_value = {
            "id": 42,
            "created_at": "2025-06-15T12:00:00",
        }
        result = await repo.create(
            data={"metric_code": "FR-001"},
            username="testuser",
        )

        assert result["id"] == 42
        assert "created_at" in result

        # Проверяем, что INSERT вызван
        query = mock_conn.fetchrow.call_args[0][0]
        assert "INSERT INTO" in query
        assert "RETURNING id, created_at" in query


# -------------------------------------------------------------------------
# soft_delete
# -------------------------------------------------------------------------


class TestSoftDelete:

    async def test_success(self, repo, mock_conn):
        """Возвращает True при успешном удалении (UPDATE 1)."""
        mock_conn.execute.return_value = "UPDATE 1"
        result = await repo.soft_delete(record_id=1, username="testuser")

        assert result is True

    async def test_not_found(self, repo, mock_conn):
        """Возвращает False, если запись не найдена (UPDATE 0)."""
        mock_conn.execute.return_value = "UPDATE 0"
        result = await repo.soft_delete(record_id=999, username="testuser")

        assert result is False


# -------------------------------------------------------------------------
# batch_update
# -------------------------------------------------------------------------


class TestBatchUpdate:

    async def test_empty_items(self, repo, mock_conn):
        """Пустой список — возвращает 0, запросов нет."""
        result = await repo.batch_update(items=[], username="testuser")
        assert result == 0
        mock_conn.execute.assert_not_called()

    async def test_items_without_id(self, repo, mock_conn):
        """Элементы без поля id — возвращает 0."""
        result = await repo.batch_update(
            items=[{"metric_code": "FR-001"}],
            username="testuser",
        )
        assert result == 0
