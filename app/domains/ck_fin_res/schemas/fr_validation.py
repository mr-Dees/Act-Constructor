"""Схемы записей FR-валидации."""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class FRValidationCreate(BaseModel):
    """Модель для создания записи FR-валидации."""

    act_sub_number_id: Optional[int] = None
    reestr_metric_id: Optional[int] = None
    application_status: str = ""
    neg_finder_tb_id: str = ""
    metric_code: str = Field(...)
    metric_name: str = ""
    metric_element_counts: int = Field(default=0, ge=0)
    metric_amount_rubles: Decimal = Decimal("0")
    is_sent_to_top_brass: bool = False
    km_id: str = ""
    num_sz: str = ""
    dt_sz: Optional[date] = None
    act_item_number: str = ""
    process_number: str = ""
    process_name: str = ""
    deviation_description: str = ""
    deviation_reason: str = ""
    deviation_consequence: str = ""
    real_loss: bool = False
    ck_comment: str = ""
    pocket: str = ""
    risk: str = ""
    rev_start_dt: Optional[datetime] = None
    rev_end_dt: Optional[datetime] = None
    process_owner: str = ""
    sberdocs_ctrl_assgn_number: str = ""
    assigment_id: Optional[int] = None
    assigment_format: str = ""
    inspection_name: str = ""
    assigment_recommendation: str = ""
    execution_deadline: Optional[datetime] = None
    used_pm_lib: str = ""
    etl_loading_id: Optional[int] = None
    applied_into_ua: bool = False


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
