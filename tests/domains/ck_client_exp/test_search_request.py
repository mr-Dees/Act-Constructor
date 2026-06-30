"""Тесты расширения ValidationSearchRequest: filters/sort_by/sort_dir."""

import pytest
from pydantic import ValidationError

from app.domains.ck_client_exp.schemas.requests import ValidationSearchRequest


def test_filters_and_sort_defaults():
    """По умолчанию: filters пустой, sort_by нет, sort_dir = asc."""
    r = ValidationSearchRequest()
    assert r.filters == {}
    assert r.sort_by is None
    assert r.sort_dir == "asc"


def test_filters_passed():
    """Переданные filters/sort_by/sort_dir сохраняются."""
    r = ValidationSearchRequest(
        filters={"metric_code": "CS001"},
        sort_by="metric_code",
        sort_dir="desc",
    )
    assert r.filters["metric_code"] == "CS001"
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
