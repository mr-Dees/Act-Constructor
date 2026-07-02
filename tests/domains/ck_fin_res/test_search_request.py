"""Тесты ValidationSearchRequest и FilterSpec: типизированный контракт фильтра."""

import pytest
from pydantic import ValidationError

from app.domains.ck_fin_res.schemas.requests import (
    FilterSpec,
    ValidationSearchRequest,
)


# -------------------------------------------------------------------------
# ValidationSearchRequest
# -------------------------------------------------------------------------


def test_filters_and_sort_defaults():
    """По умолчанию: filters пустой, sort_by нет, sort_dir = asc."""
    r = ValidationSearchRequest()
    assert r.filters == {}
    assert r.sort_by is None
    assert r.sort_dir == "asc"


def test_filters_parsed_as_filterspec():
    """filters — dict[str, FilterSpec]; словарь распознаётся как FilterSpec."""
    r = ValidationSearchRequest(
        filters={"metric_code": {"op": "contains", "value": "ФР001"}},
        sort_by="metric_code",
        sort_dir="desc",
    )
    spec = r.filters["metric_code"]
    assert isinstance(spec, FilterSpec)
    assert spec.op == "contains"
    assert spec.value == "ФР001"
    assert r.sort_by == "metric_code"
    assert r.sort_dir == "desc"


def test_bad_sort_dir_rejected():
    """Недопустимое значение sort_dir отклоняется валидацией."""
    with pytest.raises(ValidationError):
        ValidationSearchRequest(sort_dir="sideways")


def test_sort_list_default_empty():
    """По умолчанию многоколоночный sort пуст."""
    assert ValidationSearchRequest().sort == []


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
# FilterSpec
# -------------------------------------------------------------------------


def test_filterspec_contains():
    """op=contains: несёт value."""
    spec = FilterSpec(op="contains", value="12")
    assert spec.op == "contains"
    assert spec.value == "12"


def test_filterspec_in():
    """op=in: несёт список values."""
    spec = FilterSpec(op="in", values=["1", "14"])
    assert spec.op == "in"
    assert spec.values == ["1", "14"]


def test_filterspec_range_from_alias():
    """op=range: поле from заполняется по алиасу (from) и по имени (from_)."""
    by_alias = FilterSpec(op="range", cast="date", **{"from": "2025-01-01", "to": "2025-06-30"})
    assert by_alias.from_ == "2025-01-01"
    assert by_alias.to == "2025-06-30"
    assert by_alias.cast == "date"

    # populate_by_name=True → допустимо заполнять и по имени поля
    by_name = FilterSpec(op="range", cast="numeric", from_="1", to="2")
    assert by_name.from_ == "1"
    assert by_name.cast == "numeric"


def test_filterspec_eq():
    """op=eq: несёт value."""
    spec = FilterSpec(op="eq", value="true")
    assert spec.op == "eq"
    assert spec.value == "true"


def test_filterspec_bad_op_rejected():
    """Недопустимая операция отклоняется валидацией."""
    with pytest.raises(ValidationError):
        FilterSpec(op="regex", value="x")


def test_filterspec_bad_cast_rejected():
    """Недопустимое значение cast отклоняется валидацией (allowlist date/numeric)."""
    with pytest.raises(ValidationError):
        FilterSpec(op="range", cast="timestamp", **{"from": "a"})
