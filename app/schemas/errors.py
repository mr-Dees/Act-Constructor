"""Pydantic-модели ошибок для OpenAPI документации.

Унифицированный envelope: ``{"detail": str, "code": str, "extra": {...}?}``.
``extra`` — опциональное dict с дополнительными полями (locked_by, km_number и т.п.).
"""

from typing import Any

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    """Стандартная структура ошибки API (минимальный envelope)."""
    detail: str = Field(..., examples=["Описание ошибки"])
    code: str = Field(..., examples=["app-error"])
    extra: dict[str, Any] | None = Field(
        None,
        examples=[None],
        description="Дополнительные поля envelope-а (опционально)",
    )


class LockErrorExtra(BaseModel):
    """Поля ``extra`` для ошибки блокировки акта."""
    locked_by: str | None = Field(None, examples=["12345678"])
    locked_until: str | None = Field(None, examples=["2025-01-01T12:00:00"])


class LockErrorDetail(BaseModel):
    """Ошибка блокировки акта."""
    detail: str = Field(..., examples=["Акт заблокирован другим пользователем"])
    code: str = Field("act-locked", examples=["act-locked"])
    extra: LockErrorExtra


class KmConflictExtra(BaseModel):
    """Поля ``extra`` для конфликта уникальности КМ номера."""
    km_number: str | None = Field(None, examples=["КМ-01-00001"])
    current_parts: int | None = Field(None, examples=[1])
    next_part: int | None = Field(None, examples=[2])


class KmConflictDetail(BaseModel):
    """Конфликт уникальности КМ номера."""
    detail: str = Field(..., examples=["Акт с таким КМ уже существует"])
    code: str = Field("km-number-exists", examples=["km-number-exists"])
    extra: KmConflictExtra
