"""Тесты серверной фильтрации/сортировки FRValidationRepository.

Проверяют построение SQL (ILIKE по whitelist, ORDER BY, LIMIT, COUNT),
bind-параметры значений и отклонение инъекции в имя колонки сортировки.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core import settings_registry
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    ALLOWED_COLUMNS,
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
    """Mock asyncpg.Connection для поиска."""
    conn = AsyncMock()
    conn.fetch = AsyncMock()
    conn.fetchval = AsyncMock()
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
# ALLOWED_COLUMNS
# -------------------------------------------------------------------------


def test_allowed_columns_contains_view_fields():
    """Whitelist содержит ключевые колонки представления."""
    assert "metric_code" in ALLOWED_COLUMNS
    assert "metric_name" in ALLOWED_COLUMNS
    assert "act_sub_number" in ALLOWED_COLUMNS
    assert "id" in ALLOWED_COLUMNS


# -------------------------------------------------------------------------
# search_filtered
# -------------------------------------------------------------------------


class TestSearchFiltered:

    async def test_builds_ilike_order_limit_and_count(self, repo, mock_conn):
        """Фильтр+сортировка строят ILIKE/ORDER BY/LIMIT и считают total."""
        mock_conn.fetch.return_value = [{"id": 1}]
        mock_conn.fetchval.return_value = 1

        items, total = await repo.search_filtered(
            filters={"metric_code": "ФР001"},
            sort_by="metric_code",
            sort_dir="desc",
            limit=50,
            offset=0,
        )

        assert total == 1
        assert items == [{"id": 1}]

        sql = mock_conn.fetch.call_args[0][0]
        assert "ILIKE" in sql
        assert "ORDER BY" in sql.upper()
        assert "LIMIT" in sql.upper()
        # COUNT отдельным запросом
        count_sql = mock_conn.fetchval.call_args[0][0]
        assert "COUNT(*)" in count_sql.upper()

        # Значение фильтра — bind-параметр %...%, а не конкатенация
        bind_args = mock_conn.fetch.call_args[0][1:]
        assert "%ФР001%" in bind_args

    async def test_unknown_filter_column_ignored(self, repo, mock_conn):
        """Колонка не из whitelist в фильтрах игнорируется."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"evil; DROP TABLE x": "y", "metric_code": "FR"},
            sort_by=None,
            sort_dir="asc",
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "evil" not in sql
        assert "metric_code ILIKE" in sql

    async def test_empty_filters_no_where_default_order(self, repo, mock_conn):
        """Без фильтров: нет WHERE, дефолтный ORDER BY id."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={}, sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql
        assert "ORDER BY id" in sql

    async def test_injection_in_sort_rejected(self, repo, mock_conn):
        """sort_by не из whitelist → ValueError (защита ORDER BY)."""
        with pytest.raises(ValueError):
            await repo.search_filtered(
                filters={},
                sort_by="id; DROP TABLE x",
                sort_dir="asc",
                limit=50,
                offset=0,
            )

    async def test_limit_offset_bound_as_params(self, repo, mock_conn):
        """limit/offset передаются bind-параметрами после фильтров."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_code": "FR"},
            sort_by=None,
            sort_dir="asc",
            limit=25,
            offset=75,
        )

        # порядок: %FR% (фильтр), затем limit, offset
        assert mock_conn.fetch.call_args[0][1:] == ("%FR%", 25, 75)
