"""
Pydantic-схемы для работы с фактурами актов.

Определяет модели для сохранения, ответа и верификации фактур,
прикрепленных к пунктам раздела 5 актов проверки.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


# Допустимые типы метрик
VALID_METRICS_TYPES = {"КС", "ФР", "ОР", "РР", "МКР"}


class MetricItem(BaseModel):
    """Одна метрика в составе фактуры."""

    metric_type: str = Field(..., description="Тип метрики (КС, ФР, ОР, РР, МКР)")
    metric_code: str | None = Field(None, description="Код метрики из справочника")
    metric_name: str | None = Field(None, description="Название метрики из справочника")

    @field_validator("metric_type")
    @classmethod
    def validate_metric_type(cls, v: str) -> str:
        if v not in VALID_METRICS_TYPES:
            raise ValueError(
                f"Недопустимый тип метрики: {v}. "
                f"Допустимые: {VALID_METRICS_TYPES}"
            )
        return v


class InvoiceSave(BaseModel):
    """Тело POST-запроса для сохранения фактуры."""

    act_id: int = Field(..., description="ID акта")
    node_id: str = Field(..., min_length=1, description="ID узла в дереве")
    node_number: str | None = Field(None, description="Номер узла (например, 5.1.3)")
    db_type: Literal["hive", "greenplum"] = Field(..., description="Тип БД")
    schema_name: str = Field(..., min_length=1, description="Имя схемы")
    table_name: str = Field(..., min_length=1, description="Имя таблицы")
    metrics: list[MetricItem] = Field(
        ...,
        min_length=1,
        max_length=5,
        description="Список метрик (от 1 до 5)",
    )

    @model_validator(mode="after")
    def validate_unique_metric_types(self) -> "InvoiceSave":
        types = [m.metric_type for m in self.metrics]
        if len(types) != len(set(types)):
            raise ValueError("Типы метрик должны быть уникальными")
        return self


class InvoiceResponse(BaseModel):
    """Ответ после сохранения фактуры."""

    id: int
    act_id: int
    node_id: str
    node_number: str | None
    db_type: str
    schema_name: str
    table_name: str
    metrics: list[dict]
    verification_status: str
    created_at: datetime
    updated_at: datetime
    created_by: str


class InvoiceVerifyRequest(BaseModel):
    """Запрос верификации фактуры (заглушка)."""

    invoice_id: int = Field(..., description="ID фактуры для верификации")
