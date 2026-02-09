"""
Pydantic-схемы для работы с фактурами актов.

Определяет модели для сохранения, ответа и верификации фактур,
прикрепленных к пунктам раздела 5 актов проверки.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


# Допустимые типы метрик
VALID_METRICS_TYPES = {"КС", "ФР", "ОР", "РР", "МКР"}


class InvoiceSave(BaseModel):
    """Тело POST-запроса для сохранения фактуры."""

    act_id: int = Field(..., description="ID акта")
    node_id: str = Field(..., min_length=1, description="ID узла в дереве")
    node_number: str | None = Field(None, description="Номер узла (например, 5.1.3)")
    db_type: Literal["hive", "greenplum"] = Field(..., description="Тип БД")
    schema_name: str = Field(..., min_length=1, description="Имя схемы")
    table_name: str = Field(..., min_length=1, description="Имя таблицы")
    metrics_types: list[str] = Field(..., min_length=1, description="Типы метрик")

    @field_validator("metrics_types")
    @classmethod
    def validate_metrics_types(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_METRICS_TYPES
        if invalid:
            raise ValueError(
                f"Недопустимые типы метрик: {invalid}. "
                f"Допустимые: {VALID_METRICS_TYPES}"
            )
        return v


class InvoiceResponse(BaseModel):
    """Ответ после сохранения фактуры."""

    id: int
    act_id: int
    node_id: str
    node_number: str | None
    db_type: str
    schema_name: str
    table_name: str
    metrics_types: list[str]
    verification_status: str
    created_at: datetime
    updated_at: datetime
    created_by: str


class InvoiceVerifyRequest(BaseModel):
    """Запрос верификации фактуры (заглушка)."""

    invoice_id: int = Field(..., description="ID фактуры для верификации")
