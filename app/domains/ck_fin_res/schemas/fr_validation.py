"""Схемы записей FR-валидации."""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class FRValidationCreate(BaseModel):
    """Модель для создания записи FR-валидации."""

    act_sub_number_id: Optional[int] = None
    reestr_metric_id: Optional[int] = None
    application_status: str = Field(default="", max_length=200)
    neg_finder_tb_id: str = Field(default="", max_length=200)
    metric_code: str = Field(..., max_length=200)
    metric_name: str = Field(default="", max_length=500)
    metric_element_counts: int = Field(default=0, ge=0)
    metric_amount_rubles: Decimal = Decimal("0")
    is_sent_to_top_brass: bool = False
    km_id: str = Field(default="", max_length=200)
    num_sz: str = Field(default="", max_length=200)
    dt_sz: Optional[date] = None
    act_item_number: str = Field(default="", max_length=200)
    process_number: str = Field(default="", max_length=200)
    process_name: str = Field(default="", max_length=500)
    deviation_description: str = Field(default="", max_length=10000)
    deviation_reason: str = Field(default="", max_length=10000)
    deviation_consequence: str = Field(default="", max_length=10000)
    real_loss: bool = False
    ck_comment: str = Field(default="", max_length=10000)
    pocket: str = Field(default="", max_length=500)
    risk: str = Field(default="", max_length=500)
    rev_start_dt: Optional[datetime] = None
    rev_end_dt: Optional[datetime] = None
    block_owner: str = Field(default="", max_length=500)
    department_owner: str = Field(default="", max_length=500)
    sberdocs_ctrl_assgn_number: str = Field(default="", max_length=200)
    assigment_id: Optional[int] = None
    assigment_format: str = Field(default="", max_length=200)
    inspection_name: str = Field(default="", max_length=500)
    assigment_recommendation: str = Field(default="", max_length=10000)
    execution_deadline: Optional[datetime] = None
    used_pm_lib: str = Field(default="", max_length=200)
    etl_loading_id: Optional[int] = None
    row_hash: str = Field(default="", max_length=500)
    applied_into_ua: bool = False


class FRValidationBatchItem(FRValidationCreate):
    """Элемент пакетного обновления FR-валидации (id обязателен)."""

    id: int


class FRValidationRecord(FRValidationCreate):
    """Запись FR-валидации из БД (с системными полями)."""

    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    deleted_at: Optional[datetime] = None
    is_actual: bool = True


class FRValidationView(FRValidationRecord):
    """Представление FR-валидации с вычисляемыми полями (JOIN по act_sub_number_id)."""

    act_sub_number: Optional[str] = None
