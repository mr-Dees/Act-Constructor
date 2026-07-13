"""Тесты для FRValidationRepository."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

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
