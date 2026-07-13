"""Тесты серверной фильтрации/сортировки CSValidationRepository.

Проверяют построение SQL по типизированному контракту FilterSpec
(contains/eq/in/range), bind-параметры значений, allowlist-каст для range,
ORDER BY/LIMIT/COUNT и отклонение инъекции в имя колонки сортировки.
"""

from datetime import date

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core import settings_registry
from app.domains.ck_client_exp.repositories.cs_validation_repository import (
    ALLOWED_COLUMNS,
    CSValidationRepository,
)
from app.domains.ck_client_exp.schemas.requests import FilterSpec
from app.domains.ck_client_exp.settings import CkClientExpSettings


@pytest.fixture(autouse=True)
def _reset_settings():
    """Сброс реестра настроек между тестами."""
    settings_registry.reset()
    settings_registry.register("ck_client_exp", CkClientExpSettings)
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
    """Создаёт CSValidationRepository с замоканным адаптером и соединением."""
    mock_adapter = MagicMock()
    mock_adapter.qualify_table_name = lambda name, schema="": name
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        return CSValidationRepository(conn=mock_conn)


# -------------------------------------------------------------------------
# ALLOWED_COLUMNS
# -------------------------------------------------------------------------


def test_allowed_columns_contains_view_fields():
    """Whitelist содержит ключевые колонки представления, включая metric_name."""
    assert "metric_code" in ALLOWED_COLUMNS
    assert "metric_name" in ALLOWED_COLUMNS
    assert "metric_unic_clients" in ALLOWED_COLUMNS
    assert "act_sub_number" in ALLOWED_COLUMNS
    assert "id" in ALLOWED_COLUMNS


# -------------------------------------------------------------------------
# search_filtered — операции фильтра (FilterSpec)
# -------------------------------------------------------------------------


class TestFilterOps:

    async def test_contains_builds_ilike_and_binds_wildcards(self, repo, mock_conn):
        """contains → CAST(col AS TEXT) ILIKE $i, параметр %value%; COUNT отдельно."""
        mock_conn.fetch.return_value = [{"id": 1}]
        mock_conn.fetchval.return_value = 1

        items, total = await repo.search_filtered(
            filters={"metric_code": FilterSpec(op="contains", value="CS001")},
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
        count_sql = mock_conn.fetchval.call_args[0][0]
        assert "COUNT(*)" in count_sql.upper()
        # значение — bind-параметр %...%, не конкатенация
        assert "%CS001%" in mock_conn.fetch.call_args[0][1:]

    async def test_contains_empty_value_skipped(self, repo, mock_conn):
        """Пустой value у contains → фильтр пропускается (нет WHERE)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_code": FilterSpec(op="contains", value="  ")},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql
        assert mock_conn.fetch.call_args[0][1:] == (10, 0)

    async def test_eq_builds_exact_equality(self, repo, mock_conn):
        """eq → CAST(col AS TEXT) = $i, параметр без wildcard'ов."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"is_sent_to_top_brass": FilterSpec(op="eq", value="true")},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(is_sent_to_top_brass AS TEXT) = $1" in sql
        assert mock_conn.fetch.call_args[0][1:] == ("true", 10, 0)

    async def test_eq_empty_value_skipped(self, repo, mock_conn):
        """Пустой value у eq → фильтр пропускается."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_code": FilterSpec(op="eq", value="")},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql

    async def test_in_builds_membership_with_bound_values(self, repo, mock_conn):
        """in → CAST(col AS TEXT) IN ($i, ...) — текстовое равенство, как
        множественный eq (сырой col IN ронял бы бинарные кодеки asyncpg
        на нетекстовых колонках)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"neg_finder_tb_id": FilterSpec(op="in", values=["1", "14"])},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(neg_finder_tb_id AS TEXT) IN ($1, $2)" in sql
        assert mock_conn.fetch.call_args[0][1:] == ("1", "14", 10, 0)

    async def test_in_empty_values_yields_no_match(self, repo, mock_conn):
        """in с пустым values → 1=0 («совпадений нет»), без bind-параметров фильтра."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"neg_finder_tb_id": FilterSpec(op="in", values=[])},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "1=0" in sql
        assert mock_conn.fetch.call_args[0][1:] == (10, 0)

    async def test_range_date_builds_both_bounds_with_date_cast(self, repo, mock_conn):
        """range/date → CAST(col AS DATE) >= $i И <= $j по границам from/to."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "dt_sz": FilterSpec(
                    op="range", from_="2025-01-01", to="2025-06-30", cast="date"
                )
            },
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(dt_sz AS DATE) >= $1" in sql
        assert "CAST(dt_sz AS DATE) <= $2" in sql
        # Границы — date-объекты: temporal-кодеки asyncpg бинарные,
        # строка в DATE-параметре роняла бы запрос DataError.
        assert mock_conn.fetch.call_args[0][1:] == (
            date(2025, 1, 1), date(2025, 6, 30), 10, 0,
        )

    async def test_range_numeric_only_lower_bound(self, repo, mock_conn):
        """range/numeric с одной границей → единственное условие CAST ... NUMERIC >=."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "metric_amount_rubles": FilterSpec(
                    op="range", from_="100", cast="numeric"
                )
            },
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(metric_amount_rubles AS NUMERIC) >= $1" in sql
        assert "<=" not in sql
        assert mock_conn.fetch.call_args[0][1:] == ("100", 10, 0)

    async def test_range_without_cast_skipped(self, repo, mock_conn):
        """range без cast → фильтр пропускается (нет интерполяции сырого cast)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"dt_sz": FilterSpec(op="range", from_="2025-01-01", to="2025-06-30")},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql

    async def test_unknown_filter_column_ignored(self, repo, mock_conn):
        """Колонка не из whitelist в фильтрах игнорируется."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={
                "evil; DROP TABLE x": FilterSpec(op="contains", value="y"),
                "metric_code": FilterSpec(op="contains", value="CS"),
            },
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "evil" not in sql
        assert "CAST(metric_code AS TEXT) ILIKE" in sql

    async def test_contains_casts_column_to_text(self, repo, mock_conn):
        """contains кастует колонку в TEXT (ILIKE не определён для numeric/date/bool)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"metric_amount_rubles": FilterSpec(op="contains", value="100")},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "CAST(metric_amount_rubles AS TEXT) ILIKE" in sql

    async def test_contains_any_builds_or_ilike(self, repo, mock_conn):
        """contains_any → OR по CAST(col AS TEXT) ILIKE, параметр %фраза% на каждую фразу."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"ck_comment": FilterSpec(op="contains_any", values=["риск", "просрочк"])},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "(CAST(ck_comment AS TEXT) ILIKE $1 OR CAST(ck_comment AS TEXT) ILIKE $2)" in sql
        assert mock_conn.fetch.call_args[0][1:] == ("%риск%", "%просрочк%", 10, 0)

    async def test_contains_any_skips_blank_values(self, repo, mock_conn):
        """contains_any с пустым/пробельным списком → фильтр пропускается (не 1=0, в отличие от in)."""
        mock_conn.fetch.return_value = []
        mock_conn.fetchval.return_value = 0

        await repo.search_filtered(
            filters={"ck_comment": FilterSpec(op="contains_any", values=["", "  "])},
            limit=10, offset=0,
        )

        sql = mock_conn.fetch.call_args[0][0]
        assert "WHERE" not in sql


# -------------------------------------------------------------------------
# search_filtered — сортировка/пагинация
# -------------------------------------------------------------------------


class TestSortAndPaging:

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
            filters={"metric_code": FilterSpec(op="contains", value="CS")},
            sort_by=None,
            sort_dir="asc",
            limit=25,
            offset=75,
        )

        # порядок: %CS% (фильтр), затем limit, offset
        assert mock_conn.fetch.call_args[0][1:] == ("%CS%", 25, 75)

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
