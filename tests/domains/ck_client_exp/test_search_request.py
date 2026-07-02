"""Тесты типизированного контракта ValidationSearchRequest: FilterSpec/sort."""

import pytest
from pydantic import ValidationError

from app.domains.ck_client_exp.schemas.requests import (
    FilterSpec,
    ValidationSearchRequest,
)


# -------------------------------------------------------------------------
# Дефолты и sort
# -------------------------------------------------------------------------


def test_filters_and_sort_defaults():
    """По умолчанию: filters пустой, sort_by нет, sort_dir = asc, sort пуст."""
    r = ValidationSearchRequest()
    assert r.filters == {}
    assert r.sort_by is None
    assert r.sort_dir == "asc"
    assert r.sort == []


def test_bad_sort_dir_rejected():
    """Недопустимое значение sort_dir отклоняется валидацией."""
    with pytest.raises(ValidationError):
        ValidationSearchRequest(sort_dir="sideways")


def test_sort_list_parsed():
    """sort принимает список {by, dir} с приоритетом по порядку."""
    r = ValidationSearchRequest(
        sort=[{"by": "metric_code", "dir": "asc"}, {"by": "id", "dir": "desc"}]
    )
    assert [(s.by, s.dir) for s in r.sort] == [("metric_code", "asc"), ("id", "desc")]


def test_sort_list_bad_dir_rejected():
    """Недопустимое направление в элементе sort отклоняется валидацией."""
    with pytest.raises(ValidationError):
        ValidationSearchRequest(sort=[{"by": "id", "dir": "sideways"}])


# -------------------------------------------------------------------------
# FilterSpec (4 операции)
# -------------------------------------------------------------------------


def test_filters_parsed_into_filterspec():
    """filters парсятся в FilterSpec по колонкам."""
    r = ValidationSearchRequest(
        filters={"metric_code": {"op": "contains", "value": "CS001"}}
    )
    spec = r.filters["metric_code"]
    assert isinstance(spec, FilterSpec)
    assert spec.op == "contains"
    assert spec.value == "CS001"


def test_in_op_carries_values_list():
    """op=in несёт список сырых значений (для словарных колонок)."""
    r = ValidationSearchRequest(
        filters={"neg_finder_tb_id": {"op": "in", "values": ["1", "14"]}}
    )
    assert r.filters["neg_finder_tb_id"].values == ["1", "14"]


def test_range_op_uses_from_alias_and_cast():
    """op=range принимает границы from/to (alias) и cast."""
    r = ValidationSearchRequest(
        filters={
            "dt_sz": {
                "op": "range",
                "from": "2025-01-01",
                "to": "2025-06-30",
                "cast": "date",
            }
        }
    )
    spec = r.filters["dt_sz"]
    assert spec.from_ == "2025-01-01"
    assert spec.to == "2025-06-30"
    assert spec.cast == "date"


def test_bad_op_rejected():
    """Недопустимая операция фильтра отклоняется валидацией."""
    with pytest.raises(ValidationError):
        ValidationSearchRequest(filters={"metric_code": {"op": "regex", "value": "x"}})


def test_bad_cast_rejected():
    """Недопустимый cast (не date/numeric) отклоняется валидацией."""
    with pytest.raises(ValidationError):
        ValidationSearchRequest(
            filters={"dt_sz": {"op": "range", "from": "1", "cast": "timestamp"}}
        )
