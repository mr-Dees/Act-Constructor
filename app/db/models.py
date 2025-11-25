# app/db/models.py
"""
Pydantic модели для работы с актами.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class AuditTeamMember(BaseModel):
    """Член аудиторской группы."""
    role: Literal["Куратор", "Руководитель", "Участник"]
    full_name: str = Field(min_length=1, max_length=255)
    position: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)


class ActDirective(BaseModel):
    """Действующее поручение."""
    point_number: str = Field(min_length=1, max_length=50)
    directive_number: str = Field(min_length=1, max_length=100)


class ActCreate(BaseModel):
    """Схема для создания акта."""
    km_number: str = Field(min_length=1, max_length=50)
    inspection_name: str = Field(min_length=1)
    city: str = Field(min_length=1, max_length=255)
    created_date: date
    order_number: str = Field(min_length=1, max_length=100)
    order_date: date
    audit_team: list[AuditTeamMember] = Field(min_length=1)
    inspection_start_date: date
    inspection_end_date: date
    is_process_based: bool = True
    directives: list[ActDirective] = Field(default_factory=list)


class ActUpdate(BaseModel):
    """Схема для обновления метаданных акта."""
    inspection_name: str | None = None
    city: str | None = None
    created_date: date | None = None
    order_number: str | None = None
    order_date: date | None = None
    audit_team: list[AuditTeamMember] | None = None
    inspection_start_date: date | None = None
    inspection_end_date: date | None = None
    is_process_based: bool | None = None
    directives: list[ActDirective] | None = None


class ActListItem(BaseModel):
    """
    Элемент списка актов (краткая информация).

    Показывается на главной странице и в меню выбора актов.
    """
    id: int
    km_number: str
    inspection_name: str
    order_number: str
    inspection_start_date: date
    inspection_end_date: date
    last_edited_at: datetime | None
    user_role: str  # роль текущего пользователя в этом акте


class ActResponse(BaseModel):
    """Полная информация об акте."""
    id: int
    km_number: str
    inspection_name: str
    city: str
    created_date: date
    order_number: str
    order_date: date
    is_process_based: bool
    inspection_start_date: date
    inspection_end_date: date
    audit_team: list[AuditTeamMember]
    directives: list[ActDirective]
    created_at: datetime
    updated_at: datetime
    created_by: str
    last_edited_by: str | None
    last_edited_at: datetime | None
