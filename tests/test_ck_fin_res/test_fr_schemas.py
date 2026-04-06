"""Тесты для Pydantic-моделей домена ЦК Фин.Рез."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.domains.ck_fin_res.schemas.fr_validation import (
    FRValidationCreate,
    FRValidationRecord,
)
from app.domains.ck_fin_res.schemas.requests import ValidationSearchRequest


# -------------------------------------------------------------------------
# FRValidationCreate
# -------------------------------------------------------------------------


class TestFRValidationCreate:

    def test_minimal_fields(self):
        """Минимально необходимое поле — metric_code."""
        record = FRValidationCreate(metric_code="FR-001")
        assert record.metric_code == "FR-001"
        assert record.metric_element_counts == 0
        assert record.metric_amount_rubles == Decimal("0")
        assert record.is_sent_to_top_brass is False
        assert record.dt_sz is None
        assert record.act_sub_number_id is None
        assert record.reestr_metric_id is None
        assert record.application_status == ""
        assert record.metric_name == ""
        assert record.etl_loading_id is None
        assert record.row_hash == ""
        assert record.applied_into_ua is False

    def test_full_fields(self):
        """Создание с полным набором полей, включая Decimal, даты и булевы."""
        record = FRValidationCreate(
            act_sub_number_id=10,
            reestr_metric_id=100,
            application_status="Новая",
            neg_finder_tb_id="NF-07",
            metric_code="FR-002",
            metric_name="Нарушение порядка переводов",
            metric_element_counts=5,
            metric_amount_rubles=Decimal("123456.78"),
            is_sent_to_top_brass=True,
            km_id="КМ-09-12345",
            num_sz="Text/2025",
            dt_sz=date(2025, 6, 15),
            act_item_number="3.1",
            process_number="1013",
            process_name="Кредитование ЮЛ",
            deviation_description="Описание отклонения",
            deviation_reason="Причина",
            deviation_consequence="Последствие",
            real_loss=True,
            ck_comment="Комментарий ЦК",
            pocket="Карман",
            risk="Высокий",
            rev_start_dt=datetime(2025, 1, 1, 0, 0),
            rev_end_dt=datetime(2025, 6, 30, 23, 59),
            process_owner="Иванов",
            sberdocs_ctrl_assgn_number="SD-001",
            assigment_id=42,
            assigment_format="Плановая",
            inspection_name="Проверка ФР",
            assigment_recommendation="Рекомендация",
            execution_deadline=datetime(2025, 12, 31),
            used_pm_lib="PM-1",
            etl_loading_id=500,
            row_hash="abc123hash",
            applied_into_ua=True,
        )
        assert record.metric_amount_rubles == Decimal("123456.78")
        assert record.is_sent_to_top_brass is True
        assert record.dt_sz == date(2025, 6, 15)
        assert record.real_loss is True
        assert record.assigment_id == 42
        assert record.rev_start_dt == datetime(2025, 1, 1, 0, 0)
        assert record.act_sub_number_id == 10
        assert record.reestr_metric_id == 100
        assert record.application_status == "Новая"
        assert record.metric_name == "Нарушение порядка переводов"
        assert record.etl_loading_id == 500
        assert record.row_hash == "abc123hash"
        assert record.applied_into_ua is True

    def test_metric_code_required(self):
        """metric_code — обязательное поле."""
        with pytest.raises(Exception):
            FRValidationCreate()


# -------------------------------------------------------------------------
# FRValidationRecord
# -------------------------------------------------------------------------


class TestFRValidationRecord:

    def test_has_audit_fields(self):
        """Системные поля: id, is_actual, created_at и т.д."""
        record = FRValidationRecord(
            id=1,
            metric_code="FR-001",
            is_actual=True,
            created_at=datetime(2025, 3, 1, 12, 0),
        )
        assert record.id == 1
        assert record.is_actual is True
        assert record.created_at == datetime(2025, 3, 1, 12, 0)
        assert record.deleted_at is None
        assert record.updated_at is None
        assert record.created_by is None
        assert record.updated_by is None

    def test_inherits_create_fields(self):
        """FRValidationRecord наследует все поля FRValidationCreate."""
        record = FRValidationRecord(
            id=10,
            metric_code="FR-999",
            metric_element_counts=3,
        )
        assert record.metric_code == "FR-999"
        assert record.metric_element_counts == 3


# -------------------------------------------------------------------------
# ValidationSearchRequest
# -------------------------------------------------------------------------


class TestValidationSearchRequest:

    def test_date_range_invalid(self):
        """end_date < start_date вызывает ValueError."""
        with pytest.raises(ValueError, match="end_date"):
            ValidationSearchRequest(
                start_date=date(2025, 6, 1),
                end_date=date(2025, 5, 1),
            )

    def test_date_range_valid(self):
        """Корректный диапазон дат проходит валидацию."""
        req = ValidationSearchRequest(
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
        assert req.start_date == date(2025, 1, 1)
        assert req.end_date == date(2025, 12, 31)

    def test_empty_request(self):
        """Пустой запрос (без фильтров) валиден."""
        req = ValidationSearchRequest()
        assert req.start_date is None
        assert req.end_date is None
        assert req.metric_code == []
        assert req.process_code == []
