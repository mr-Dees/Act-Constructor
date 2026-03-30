"""Pydantic-схемы для аудит-лога и версий содержимого."""

from datetime import datetime

from pydantic import BaseModel, Field


class AuditLogEntry(BaseModel):
    """Запись аудит-лога."""
    id: int
    action: str
    username: str
    details: dict
    changelog: list[dict] = Field(default_factory=list)
    created_at: datetime


class AuditLogResponse(BaseModel):
    """Список записей аудит-лога с пагинацией."""
    items: list[AuditLogEntry]
    total: int


class ContentVersionEntry(BaseModel):
    """Запись версии содержимого (без данных)."""
    id: int
    version_number: int
    save_type: str
    username: str
    created_at: datetime


class ContentVersionsResponse(BaseModel):
    """Список версий с пагинацией."""
    items: list[ContentVersionEntry]
    total: int


class ContentVersionDetail(BaseModel):
    """Полный снэпшот для просмотра/восстановления."""
    id: int
    version_number: int
    save_type: str
    username: str
    tree_data: dict
    tables_data: dict
    textblocks_data: dict
    violations_data: dict
    created_at: datetime
