"""Тесты для Pydantic-моделей домена ЦК Клиентский опыт."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.domains.ck_client_exp.schemas.cs_validation import (
    CSValidationCreate,
    CSValidationRecord,
)
from app.domains.ck_client_exp.schemas.requests import ValidationSearchRequest


# -------------------------------------------------------------------------
# CSValidationCreate
# -------------------------------------------------------------------------


class TestCSValidationCreate:

    def test_minimal_fields(self):
        """Минимально необходимое поле — metric_code."""
        record = CSValidationCreate(metric_code="CS-001")
        assert record.metric_code == "CS-001"
        assert record.metric_unic_clients == 0
        assert record.metric_element_counts == 0
        assert record.metric_amount_rubles == Decimal("0")
        assert record.is_sent_to_top_brass is False
        assert record.reestr_metric_id is None
        assert record.dt_sz is None

    def test_metric_unic_clients_field(self):
        """metric_unic_clients — CS-специфичное поле (уникальные клиенты)."""
        record = CSValidationCreate(
            metric_code="CS-002",
            metric_unic_clients=150,
        )
        assert record.metric_unic_clients == 150

    def test_metric_unic_clients_non_negative(self):
        """metric_unic_clients не может быть отрицательным (ge=0)."""
        with pytest.raises(Exception):
            CSValidationCreate(metric_code="CS-001", metric_unic_clients=-1)

    def test_metric_code_required(self):
        """metric_code — обязательное поле."""
        with pytest.raises(Exception):
            CSValidationCreate()

    def test_full_fields(self):
        """Создание с полным набором полей."""
        record = CSValidationCreate(
            reestr_metric_id=456,
            neg_finder_tb_id="NF-03",
            metric_code="CS-010",
            metric_unic_clients=200,
            metric_element_counts=15,
            metric_amount_rubles=Decimal("999999.99"),
            is_sent_to_top_brass=True,
            km_id="КМ-05-00001",
            num_sz="Text/2025",
            dt_sz=date(2025, 7, 20),
            act_item_number="2.1",
            process_number="2050",
            process_name="Обслуживание клиентов",
            ck_comment="Комментарий ЦК",
        )
        assert record.metric_amount_rubles == Decimal("999999.99")
        assert record.is_sent_to_top_brass is True
        assert record.dt_sz == date(2025, 7, 20)
        assert record.metric_unic_clients == 200


# -------------------------------------------------------------------------
# CSValidationRecord
# -------------------------------------------------------------------------


class TestCSValidationRecord:

    def test_has_audit_fields(self):
        """Системные поля: id, is_actual, created_at и т.д."""
        record = CSValidationRecord(
            id=1,
            metric_code="CS-001",
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
        """CSValidationRecord наследует все поля CSValidationCreate."""
        record = CSValidationRecord(
            id=10,
            metric_code="CS-999",
            metric_unic_clients=42,
            metric_element_counts=3,
        )
        assert record.metric_code == "CS-999"
        assert record.metric_unic_clients == 42
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
