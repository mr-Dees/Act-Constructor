"""Тесты групповых контрактов ЦКФР."""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.domains.ck_fin_res.exceptions import FRGroupConflictError
from app.domains.ck_fin_res.schemas.group import (
    FRGroupSaveRequest,
    GroupKey,
    TBBreakdownItem,
)


def _key() -> dict:
    return {"act_sub_number_id": 1, "km_id": "КМ-09-41726",
            "act_item_number": "5.1.1", "metric_code": "2002"}


def _common() -> dict:
    return {"metric_code": "2002"}


def test_breakdown_item_requires_positive_amount():
    with pytest.raises(ValidationError):
        TBBreakdownItem(neg_finder_tb_id="7", metric_amount_rubles=Decimal("0"))
    item = TBBreakdownItem(neg_finder_tb_id="7", metric_amount_rubles=Decimal("0.01"))
    assert item.metric_element_counts == 0


class TestTBBreakdownItemNpl:
    def test_npl_default_zero(self):
        item = TBBreakdownItem(neg_finder_tb_id="7", metric_amount_rubles=Decimal("100"))
        assert item.npl_amount_rubles == Decimal("0")

    def test_npl_only_row_is_valid(self):
        item = TBBreakdownItem(
            neg_finder_tb_id="7", metric_amount_rubles=Decimal("0"),
            npl_amount_rubles=Decimal("120000.00"),
        )
        assert item.metric_amount_rubles == Decimal("0")

    def test_both_zero_rejected(self):
        with pytest.raises(ValidationError):
            TBBreakdownItem(neg_finder_tb_id="7", metric_amount_rubles=Decimal("0"))

    def test_negative_npl_rejected(self):
        with pytest.raises(ValidationError):
            TBBreakdownItem(
                neg_finder_tb_id="7", metric_amount_rubles=Decimal("1"),
                npl_amount_rubles=Decimal("-1"),
            )


def test_group_save_rejects_empty_breakdown():
    with pytest.raises(ValidationError):
        FRGroupSaveRequest(group_key=_key(), expected_row_ids=[], common=_common(), breakdown=[])


def test_group_save_rejects_duplicate_tb():
    with pytest.raises(ValidationError):
        FRGroupSaveRequest(
            group_key=_key(), expected_row_ids=[], common=_common(),
            breakdown=[
                {"neg_finder_tb_id": "7", "metric_amount_rubles": "100.00"},
                {"neg_finder_tb_id": "7", "metric_amount_rubles": "200.00"},
            ],
        )


def test_group_save_valid():
    req = FRGroupSaveRequest(
        group_key=_key(), expected_row_ids=[101, 102], common=_common(),
        breakdown=[
            {"neg_finder_tb_id": "7", "metric_amount_rubles": "980000.00", "metric_element_counts": 8},
            {"neg_finder_tb_id": "8", "metric_amount_rubles": "215000.00"},
        ],
    )
    assert req.group_key.km_id == "КМ-09-41726"
    assert req.breakdown[0].metric_amount_rubles == Decimal("980000.00")


def test_conflict_error_is_409():
    exc = FRGroupConflictError("конфликт")
    assert exc.status_code == 409
