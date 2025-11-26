# app/db/models.py
"""
Pydantic-модели для проверки входящих/исходящих данных актов и связанных сущностей.

Включает:
- Членов аудиторской группы
- Поручения
- Схемы для создания/обновления актов
- Список и полную структуру акта для API
"""

from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class AuditTeamMember(BaseModel):
    """
    Член аудиторской группы, назначенный для участия в акте.

    Атрибуты:
        role: Роль в команде ("Куратор", "Руководитель", "Участник")
        full_name: Фамилия Имя Отчество
        position: Должность
        username: Логин/username в Системе (уникальный)
    """
    role: Literal["Куратор", "Руководитель", "Участник"]
    full_name: str = Field(min_length=1, max_length=255)
    position: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)


class ActDirective(BaseModel):
    """
    Поручение, добавленное к акту.

    Атрибуты:
        point_number: Номер пункта/подпункта, к которому относится поручение
        directive_number: Номер самого поручения
    """
    point_number: str = Field(min_length=1, max_length=50)
    directive_number: str = Field(min_length=1, max_length=100)


class ActCreate(BaseModel):
    """
    Модель для валидации входящих данных при создании акта.

    Атрибуты:
        km_number: Уникальный номер КМ
        inspection_name: Наименование проверки
        city: Город
        created_date: Дата создания акта
        order_number: Номер приказа
        order_date: Дата приказа
        audit_team: Список членов аудиторской группы
        inspection_start_date: Начало периода проверки
        inspection_end_date: Конец периода проверки
        is_process_based: Признак процессной проверки
        directives: Список поручений (по умолчанию пустой)
    """
    km_number: str = Field(min_length=1, max_length=50)
    inspection_name: str = Field(min_length=1)
    city: str = Field(min_length=1, max_length=255)
    created_date: date
    order_number: str = Field(min_length=1, max_length=100)
    order_date: date
    audit_team: List[AuditTeamMember] = Field(min_length=1)
    inspection_start_date: date
    inspection_end_date: date
    is_process_based: bool = True
    directives: List[ActDirective] = Field(default_factory=list)


class ActUpdate(BaseModel):
    """
    Модель для валидации обновления акта (patch).

    Все поля опциональны, поддерживает частичное обновление.
    """
    inspection_name: Optional[str] = None
    city: Optional[str] = None
    created_date: Optional[date] = None
    order_number: Optional[str] = None
    order_date: Optional[date] = None
    audit_team: Optional[List[AuditTeamMember]] = None
    inspection_start_date: Optional[date] = None
    inspection_end_date: Optional[date] = None
    is_process_based: Optional[bool] = None
    directives: Optional[List[ActDirective]] = None


class ActListItem(BaseModel):
    """
    Краткая информация об акте для вывода в списке.

    Отображается в списке документов или селекторах.
    """
    id: int
    km_number: str
    inspection_name: str
    order_number: str
    inspection_start_date: date
    inspection_end_date: date
    last_edited_at: Optional[datetime]
    user_role: str  # Роль текущего пользователя относительно этого акта


class ActResponse(BaseModel):
    """
    Полная информация об акте, возвращаемая для просмотра/редактирования.

    Содержит весь состав группы и список поручений.
    """
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
    audit_team: List[AuditTeamMember]
    directives: List[ActDirective]
    created_at: datetime
    updated_at: datetime
    created_by: str
    last_edited_by: Optional[str]
    last_edited_at: Optional[datetime]
