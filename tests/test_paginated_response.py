"""Unit-тесты для общей схемы PaginatedResponse."""

from pydantic import BaseModel, ValidationError
import pytest

from app.core.responses import PaginatedResponse


class _Item(BaseModel):
    id: int
    label: str


def test_paginated_response_serializes_four_required_fields():
    page = PaginatedResponse[_Item](
        items=[_Item(id=1, label="a"), _Item(id=2, label="b")],
        total=42,
        limit=50,
        offset=0,
    )
    data = page.model_dump()
    assert set(data.keys()) == {"items", "total", "limit", "offset"}
    assert data["total"] == 42
    assert data["limit"] == 50
    assert data["offset"] == 0
    assert len(data["items"]) == 2
    assert data["items"][0] == {"id": 1, "label": "a"}


def test_paginated_response_empty_items_is_valid():
    page = PaginatedResponse[_Item](items=[], total=0, limit=50, offset=0)
    assert page.items == []
    assert page.total == 0


def test_paginated_response_requires_all_fields():
    with pytest.raises(ValidationError):
        PaginatedResponse[_Item](items=[], total=0, limit=50)  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        PaginatedResponse[_Item](items=[], total=0, offset=0)  # type: ignore[call-arg]


def test_paginated_response_generic_validates_item_shape():
    with pytest.raises(ValidationError):
        PaginatedResponse[_Item](
            items=[{"id": "не число", "label": "x"}],
            total=1,
            limit=50,
            offset=0,
        )
