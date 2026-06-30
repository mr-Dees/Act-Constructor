"""Схемы запросов домена ЦК Фин.Рез."""

from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class SortSpec(BaseModel):
    """Одна колонка многоколоночной сортировки (приоритет — порядок в списке)."""

    by: str
    dir: Literal["asc", "desc"] = "asc"


class ValidationSearchRequest(BaseModel):
    """Параметры поиска записей FR-валидации."""

    start_date: Optional[date] = None
    end_date: Optional[date] = None
    metric_code: list[str] = Field(default_factory=list)
    process_code: list[str] = Field(default_factory=list)
    # Колоночные фильтры: {имя колонки → подстрока}. Имена валидируются против
    # whitelist в репозитории (защита от инъекций в ORDER BY/имена колонок).
    filters: dict[str, str] = Field(default_factory=dict)
    sort_by: Optional[str] = None
    sort_dir: Literal["asc", "desc"] = "asc"
    # Многоколоночная сортировка по приоритету (перекрывает sort_by/sort_dir,
    # если непустая). Имена колонок валидируются против whitelist в репозитории.
    sort: list[SortSpec] = Field(default_factory=list)
    # Верхняя граница страницы определяется working_set_cap домена (сервис
    # клампит limit), поэтому жёсткого потолка в схеме нет.
    limit: int = Field(default=50, ge=1)
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
