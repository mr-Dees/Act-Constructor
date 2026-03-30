"""Pydantic-модели ошибок для OpenAPI документации."""

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    """Стандартная структура ошибки API."""
    detail: str = Field(..., examples=["Описание ошибки"])


class LockErrorDetail(BaseModel):
    """Ошибка блокировки акта."""
    detail: str = Field(..., examples=["Акт заблокирован другим пользователем"])
    locked_by: str | None = Field(None, examples=["12345678"])
    locked_until: str | None = Field(None, examples=["2025-01-01T12:00:00"])


class KmConflictDetail(BaseModel):
    """Конфликт уникальности КМ номера."""
    detail: str = Field(..., examples=["Акт с таким КМ уже существует"])
    type: str = Field("km_exists", examples=["km_exists"])
    km_number: str | None = Field(None, examples=["КМ-01-00001"])
    current_parts: int | None = Field(None, examples=[1])
    next_part: int | None = Field(None, examples=[2])
