from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator


class AuditTeamMember(BaseModel):
    """Член аудиторской группы"""
    role: Literal["Куратор", "Руководитель", "Участник"]
    full_name: str = Field(min_length=1, max_length=255)
    position: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=255)


class ActDirective(BaseModel):
    """Поручение"""
    point_number: str = Field(min_length=1, max_length=50)
    directive_number: str = Field(min_length=1, max_length=100)

    @field_validator('point_number')
    @classmethod
    def validate_point_is_under_section_5(cls, v):
        """Проверяет что поручение относится к разделу 5"""
        if not v.startswith('5.'):
            raise ValueError(f'Поручения могут быть только в разделе 5 (получено: {v})')

        # Проверяем формат: должно быть 5.X.Y где X и Y - числа
        parts = v.split('.')
        if len(parts) < 3:
            raise ValueError(f'Неверный формат пункта поручения: {v}. Ожидается формат 5.X.Y')

        try:
            # Проверяем что все части после 5 - числа
            for part in parts[1:]:
                int(part)
        except ValueError:
            raise ValueError(f'Неверный формат пункта поручения: {v}. Все части должны быть числами')

        return v


class ActCreate(BaseModel):
    """Модель для создания акта"""
    km_number: str = Field(min_length=1, max_length=50)
    part_number: int = Field(default=1, ge=1)
    total_parts: int = Field(default=1, ge=1)
    inspection_name: str = Field(min_length=1)
    city: str = Field(min_length=1, max_length=255)
    created_date: Optional[date] = None
    order_number: str = Field(min_length=1, max_length=100)
    order_date: date
    audit_team: List[AuditTeamMember] = Field(min_length=1)
    inspection_start_date: date
    inspection_end_date: date
    is_process_based: bool = True
    directives: List[ActDirective] = Field(default_factory=list)

    @field_validator('part_number')
    @classmethod
    def validate_part_number(cls, v, info):
        total = info.data.get('total_parts', 1)
        if v > total:
            raise ValueError(f'Номер части ({v}) не может быть больше общего количества частей ({total})')
        return v

    @field_validator('audit_team')
    @classmethod
    def validate_audit_team_composition(cls, v):
        """Проверяет наличие минимум 1 куратора и 1 руководителя"""
        if not v:
            raise ValueError('Аудиторская группа не может быть пустой')

        curators = [m for m in v if m.role == 'Куратор']
        leaders = [m for m in v if m.role == 'Руководитель']

        if len(curators) < 1:
            raise ValueError('В аудиторской группе должен быть хотя бы один куратор')

        if len(leaders) < 1:
            raise ValueError('В аудиторской группе должен быть хотя бы один руководитель')

        return v


class ActUpdate(BaseModel):
    """Модель для обновления акта (все поля опциональны)"""
    km_number: Optional[str] = None
    part_number: Optional[int] = Field(default=None, ge=1)
    total_parts: Optional[int] = Field(default=None, ge=1)
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

    @field_validator('audit_team')
    @classmethod
    def validate_audit_team_composition(cls, v):
        """Проверяет наличие минимум 1 куратора и 1 руководителя"""
        if v is None:
            return v

        if not v:
            raise ValueError('Аудиторская группа не может быть пустой')

        curators = [m for m in v if m.role == 'Куратор']
        leaders = [m for m in v if m.role == 'Руководитель']

        if len(curators) < 1:
            raise ValueError('В аудиторской группе должен быть хотя бы один куратор')

        if len(leaders) < 1:
            raise ValueError('В аудиторской группе должен быть хотя бы один руководитель')

        return v


class ActListItem(BaseModel):
    """Краткая информация об акте для списка"""
    id: int
    km_number: str
    part_number: int
    total_parts: int
    inspection_name: str
    order_number: str
    inspection_start_date: date
    inspection_end_date: date
    last_edited_at: Optional[datetime]
    user_role: str


class ActResponse(BaseModel):
    """Полная информация об акте"""
    id: int
    km_number: str
    part_number: int
    total_parts: int
    inspection_name: str
    city: str
    created_date: Optional[date] = None
    order_number: str
    order_date: date
    is_process_based: bool
    inspection_start_date: date
    inspection_end_date: date
    audit_team: List[AuditTeamMember]
    directives: List[ActDirective]

    # Служебные флаги валидации (для будущего использования)
    needs_created_date: bool = False
    needs_directive_number: bool = False
    needs_invoice_check: bool = False

    created_at: datetime
    updated_at: datetime
    created_by: str
    last_edited_by: Optional[str]
    last_edited_at: Optional[datetime]
