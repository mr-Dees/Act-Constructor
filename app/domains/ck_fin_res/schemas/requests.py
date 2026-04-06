"""Схемы запросов домена ЦК Фин.Рез."""

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ValidationSearchRequest(BaseModel):
    """Параметры поиска записей FR-валидации."""

    start_date: Optional[date] = None
    end_date: Optional[date] = None
    metric_code: list[str] = Field(default_factory=list)
    process_code: list[str] = Field(default_factory=list)
    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def validate_date_range(self):
        """Проверяет корректность диапазона дат."""
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date < self.start_date
        ):
            raise ValueError("end_date не может быть раньше start_date")
        return self
