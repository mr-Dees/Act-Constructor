"""Тесты серверной фильтрации/сортировки FRValidationRepository.

Проверяют построение SQL из типизированных FilterSpec (contains/in/range/eq),
bind-параметры значений, cast по allowlist, ``1=0`` для пустого ``in``,
whitelist-guard колонок и отклонение инъекции в имя колонки сортировки.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core import settings_registry
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    ALLOWED_COLUMNS,
    FRValidationRepository,
)
from app.domains.ck_fin_res.schemas.requests import FilterSpec
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

    async def test_contains_builds_ilike_order_limit_and_count(self, repo, mock_conn):
        """op=contains + сортировка строят ILIKE/ORDER BY/LIMIT и считают total."""
        mock_conn.fetch.return_value = [{"id": 1}]
        mock_conn.fetchval.return_value = 1

        items, total = await repo.search_filtered(
            filters={"metric_code": FilterSpec(op="contains", value="ФР001")},
            sort_by="metric_code",
            sort_dir="desc",
            limit=50,
            offset=0,
        )

        assert total == 1
        assert items == [{"id": 1}]

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(metric_code AS TEXT) ILIKE" in sql
        assert "ORDER BY" in sql.upper()
        assert "LIMIT" in sql.upper()
        # COUNT отдельным запросом
        count_sql = mock_conn.fetchval.call_args[0][0]
        assert "COUNT(*)" in count_sql.upper()

        # Значение фильтра — bind-параметр %...%, а не конкатенация
        bind_args = mock_conn.fetch.call_args[0][1:]
        assert "%ФР001%" in bind_args

    async def test_contains_empty_value_skipped(self, repo, mock_conn):
        """op=contains с пустым value → фильтр пропускается, нет WHERE."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_code": FilterSpec(op="contains", value="")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql

    async def test_unknown_filter_column_ignored(self, repo, mock_conn):
        """Колонка не из whitelist в фильтрах игнорируется (для любой op)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "evil; DROP TABLE x": FilterSpec(op="in", values=["y"]),
                "metric_code": FilterSpec(op="contains", value="FR"),
            },
            sort_by=None,
            sort_dir="asc",
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "evil" not in sql
        assert "CAST(metric_code AS TEXT) ILIKE" in sql

    async def test_filter_casts_column_to_text(self, repo, mock_conn):
        """contains/eq кастуют колонку в TEXT (не определены для numeric/date/bool)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_amount_rubles": FilterSpec(op="contains", value="100")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(metric_amount_rubles AS TEXT) ILIKE" in sql

    async def test_eq_builds_text_equality(self, repo, mock_conn):
        """op=eq: CAST(col AS TEXT) = $i с сырым значением bind-параметром."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"is_sent_to_top_brass": FilterSpec(op="eq", value="true")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(is_sent_to_top_brass AS TEXT) = $1" in sql
        assert mock_conn.fetch.call_args[0][1:] == ("true", 10, 0)

    async def test_eq_empty_value_skipped(self, repo, mock_conn):
        """op=eq с пустым value → фильтр пропускается, нет WHERE."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"is_sent_to_top_brass": FilterSpec(op="eq", value="")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql

    async def test_in_builds_in_clause_by_raw_values(self, repo, mock_conn):
        """op=in: col IN ($1, $2) по сырым values (без CAST в TEXT)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"neg_finder_tb_id": FilterSpec(op="in", values=["1", "14"])},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "neg_finder_tb_id IN ($1, $2)" in sql
        # params: сырые values, затем limit/offset
        assert mock_conn.fetch.call_args[0][1:] == ("1", "14", 10, 0)

    async def test_in_empty_values_yields_no_match(self, repo, mock_conn):
        """op=in с пустым списком values → условие 1=0 (совпадений нет)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"neg_finder_tb_id": FilterSpec(op="in", values=[])},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "1=0" in sql
        # 1=0 не потребляет bind-параметр — только limit/offset
        assert mock_conn.fetch.call_args[0][1:] == (10, 0)

    async def test_range_date_cast_both_bounds(self, repo, mock_conn):
        """op=range cast=date: CAST(col AS DATE) >= .. AND <= .. по границам from/to."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "dt_sz": FilterSpec(
                    op="range", cast="date",
                    **{"from": "2025-01-01", "to": "2025-06-30"},
                )
            },
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(dt_sz AS DATE) >= $1" in sql
        assert "CAST(dt_sz AS DATE) <= $2" in sql
        assert mock_conn.fetch.call_args[0][1:] == ("2025-01-01", "2025-06-30", 10, 0)

    async def test_range_numeric_cast(self, repo, mock_conn):
        """op=range cast=numeric: колонка кастуется в NUMERIC."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "metric_amount_rubles": FilterSpec(
                    op="range", cast="numeric", from_="100", to="500",
                )
            },
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(metric_amount_rubles AS NUMERIC) >= $1" in sql
        assert "CAST(metric_amount_rubles AS NUMERIC) <= $2" in sql

    async def test_range_only_from_bound(self, repo, mock_conn):
        """op=range с одной границей from → только условие >=."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"dt_sz": FilterSpec(op="range", cast="date", from_="2025-01-01")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(dt_sz AS DATE) >= $1" in sql
        assert ">= $1" in sql and "<= " not in sql
        assert mock_conn.fetch.call_args[0][1:] == ("2025-01-01", 10, 0)

    async def test_range_without_cast_skipped(self, repo, mock_conn):
        """op=range без cast → фильтр пропускается (нет allowlist-типа)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"dt_sz": FilterSpec(op="range", from_="2025-01-01", to="2025-06-30")},
            sort_by=None, sort_dir="asc", limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql

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
            filters={"metric_code": FilterSpec(op="contains", value="FR")},
            sort_by=None,
            sort_dir="asc",
            limit=25,
            offset=75,
        )

        # порядок: %FR% (фильтр), затем limit, offset
        assert mock_conn.fetch.call_args[0][1:] == ("%FR%", 25, 75)

    async def test_multi_sort_builds_ordered_order_by(self, repo, mock_conn):
        """sort — упорядоченный список (колонка, направление) → ORDER BY c1 d1, c2 d2."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={},
            sort=[("metric_code", "asc"), ("metric_amount_rubles", "desc")],
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "ORDER BY metric_code ASC, metric_amount_rubles DESC" in sql

    async def test_multi_sort_validates_each_column(self, repo, mock_conn):
        """Любая колонка sort не из whitelist → ValueError (защита ORDER BY)."""
        with pytest.raises(ValueError):
            await repo.search_filtered(
                filters={},
                sort=[("metric_code", "asc"), ("evil; DROP TABLE x", "desc")],
                limit=10,
                offset=0,
            )

    async def test_sort_list_overrides_single_sort_by(self, repo, mock_conn):
        """При непустом sort одиночные sort_by/sort_dir игнорируются."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={},
            sort=[("metric_code", "asc")],
            sort_by="id",
            sort_dir="desc",
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "ORDER BY metric_code ASC" in sql
        assert "id DESC" not in sql

    async def test_order_by_appends_stable_id_tiebreak(self, repo, mock_conn):
        """К ORDER BY добавляется завершающий id ASC — детерминированная пагинация."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={},
            sort=[("metric_code", "desc")],
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "ORDER BY metric_code DESC, id ASC" in sql

    async def test_id_tiebreak_not_duplicated_when_already_sorted(self, repo, mock_conn):
        """Если id уже в наборе сортировки — повторный id ASC не добавляется."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={},
            sort=[("id", "desc")],
            limit=10,
            offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "ORDER BY id DESC" in sql
        assert "id ASC" not in sql
