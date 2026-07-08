"""Тесты построения WHERE в FRValidationRepository._build_filter_where.

Проверяют построение SQL из типизированных FilterSpec (contains/in/range/eq),
bind-параметры значений, cast по allowlist, ``1=0`` для пустого ``in``,
whitelist-guard колонок. Сортировка — забота ``search_groups``, покрыта
в test_fr_repository_groups.py.
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
# _build_filter_where
# -------------------------------------------------------------------------


class TestBuildFilterWhere:

    def test_contains_builds_ilike(self, repo):
        """op=contains: CAST(col AS TEXT) ILIKE $i с bind-параметром %value%."""
        where, params, idx = repo._build_filter_where(
            {"metric_code": FilterSpec(op="contains", value="ФР001")}
        )
        assert "CAST(metric_code AS TEXT) ILIKE $1" in where
        assert params == ["%ФР001%"]
        assert idx == 2

    def test_contains_empty_value_skipped(self, repo):
        """op=contains с пустым value → фильтр пропускается, WHERE пуст."""
        where, params, idx = repo._build_filter_where(
            {"metric_code": FilterSpec(op="contains", value="")}
        )
        assert where == ""
        assert params == []

    def test_unknown_filter_column_ignored(self, repo):
        """Колонка не из whitelist в фильтрах игнорируется (для любой op)."""
        where, params, idx = repo._build_filter_where({
            "evil; DROP TABLE x": FilterSpec(op="in", values=["y"]),
            "metric_code": FilterSpec(op="contains", value="FR"),
        })
        assert "evil" not in where
        assert "CAST(metric_code AS TEXT) ILIKE" in where

    def test_filter_casts_column_to_text(self, repo):
        """contains/eq кастуют колонку в TEXT (не определены для numeric/date/bool)."""
        where, params, idx = repo._build_filter_where(
            {"metric_amount_rubles": FilterSpec(op="contains", value="100")}
        )
        assert "CAST(metric_amount_rubles AS TEXT) ILIKE" in where

    def test_eq_builds_text_equality(self, repo):
        """op=eq: CAST(col AS TEXT) = $i с сырым значением bind-параметром."""
        where, params, idx = repo._build_filter_where(
            {"is_sent_to_top_brass": FilterSpec(op="eq", value="true")}
        )
        assert "CAST(is_sent_to_top_brass AS TEXT) = $1" in where
        assert params == ["true"]

    def test_eq_empty_value_skipped(self, repo):
        """op=eq с пустым value → фильтр пропускается, WHERE пуст."""
        where, params, idx = repo._build_filter_where(
            {"is_sent_to_top_brass": FilterSpec(op="eq", value="")}
        )
        assert where == ""

    def test_in_builds_in_clause_by_raw_values(self, repo):
        """op=in: col IN ($1, $2) по сырым values (без CAST в TEXT)."""
        where, params, idx = repo._build_filter_where(
            {"neg_finder_tb_id": FilterSpec(op="in", values=["1", "14"])}
        )
        assert "neg_finder_tb_id IN ($1, $2)" in where
        assert params == ["1", "14"]

    def test_in_empty_values_yields_no_match(self, repo):
        """op=in с пустым списком values → условие 1=0 (совпадений нет), без bind-параметра."""
        where, params, idx = repo._build_filter_where(
            {"neg_finder_tb_id": FilterSpec(op="in", values=[])}
        )
        assert "1=0" in where
        assert params == []

    def test_range_date_cast_both_bounds(self, repo):
        """op=range cast=date: CAST(col AS DATE) >= .. AND <= .. по границам from/to."""
        where, params, idx = repo._build_filter_where({
            "dt_sz": FilterSpec(
                op="range", cast="date",
                **{"from": "2025-01-01", "to": "2025-06-30"},
            )
        })
        assert "CAST(dt_sz AS DATE) >= $1" in where
        assert "CAST(dt_sz AS DATE) <= $2" in where
        assert params == ["2025-01-01", "2025-06-30"]

    def test_range_numeric_cast(self, repo):
        """op=range cast=numeric: колонка кастуется в NUMERIC."""
        where, params, idx = repo._build_filter_where({
            "metric_amount_rubles": FilterSpec(
                op="range", cast="numeric", from_="100", to="500",
            )
        })
        assert "CAST(metric_amount_rubles AS NUMERIC) >= $1" in where
        assert "CAST(metric_amount_rubles AS NUMERIC) <= $2" in where

    def test_range_only_from_bound(self, repo):
        """op=range с одной границей from → только условие >=."""
        where, params, idx = repo._build_filter_where(
            {"dt_sz": FilterSpec(op="range", cast="date", from_="2025-01-01")}
        )
        assert "CAST(dt_sz AS DATE) >= $1" in where
        assert ">= $1" in where and "<= " not in where
        assert params == ["2025-01-01"]

    def test_range_without_cast_skipped(self, repo):
        """op=range без cast → фильтр пропускается (нет allowlist-типа)."""
        where, params, idx = repo._build_filter_where(
            {"dt_sz": FilterSpec(op="range", from_="2025-01-01", to="2025-06-30")}
        )
        assert where == ""

    def test_empty_filters_no_where(self, repo):
        """Без фильтров: WHERE пуст, params пуст, idx не сдвинут."""
        where, params, idx = repo._build_filter_where({})
        assert where == ""
        assert params == []
        assert idx == 1
