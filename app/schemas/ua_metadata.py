import re
from datetime import date, datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class User(BaseModel):
    """Пользователь системы"""
    username: str = Field(min_length=1, max_length=50)
    fullname: str = Field(min_length=1, max_length=255)



class UserRole(BaseModel):
    """Таблица со списком ролей для каждого пользователя"""
    role_id: int = Field(min_length=1, max_length=50)
    username: str = Field(min_length=1, max_length=50)


class FinResReportView(BaseModel):
    """Таблица для отображения отчета для ЦК ФР"""
    id_in_metrics_registry: int
    tb_identified_metric: int
    metric_code: int
    metric_name: str
    metric_element_count: int
    metric_amount_rubles: float
    is_sent_to_top_brass: bool
    km_num: str
    num_sz: str
    dt_sz: datetime
    act_item_number: str
    process_number: str
    process_name: str
    deviation_description: str
    fin_res_comment: str
    pocket: str
    risk: str
    audited_period_start_date: datetime
    audited_period_end_date: datetime
    process_owner: str
    sberdocs_ctrl_assgn_number: str
    assignment_id_in_uva_register: int
    assignment_format: str = Literal['СК', 'ЦК']
    inspection_name: str
    recomm_wording: str
    execution_deadline: datetime
    use_of_pm_library: str
