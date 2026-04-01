"""Схемы записей CS-валидации."""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class CSValidationCreate(BaseModel):
    """Модель для создания записи CS-валидации."""

    reestr_metric_id: str = ""
    neg_finder_tb_id: str = ""
    metric_code: str = Field(...)
    metric_unic_clients: int = Field(default=0, ge=0)
    metric_element_counts: int = Field(default=0, ge=0)
    metric_amount_rubles: Decimal = Decimal("0")
    is_sent_to_top_brass: bool = False
    km_id: str = ""
    num_sz: str = ""
    dt_sz: Optional[date] = None
    act_item_number: str = ""
    process_number: str = ""
    process_name: str = ""
    ck_comment: str = ""


class CSValidationRecord(CSValidationCreate):
    """Запись CS-валидации из БД (с системными полями)."""

    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    deleted_at: Optional[datetime] = None
    is_actual: bool = True


class CSValidationView(CSValidationRecord):
    """Представление CS-валидации с вычисляемыми полями."""

    act_sub_number: Optional[str] = None
