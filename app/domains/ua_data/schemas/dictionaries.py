"""Pydantic схемы справочных таблиц UA."""

from datetime import datetime

from pydantic import BaseModel


class _AuditFieldsMixin(BaseModel):
    """Общие аудит-поля для всех справочников."""

    created_at: datetime | None = None
    updated_at: datetime | None = None
    created_by: str | None = "system"
    updated_by: str | None = None
    deleted_at: datetime | None = None
    is_actual: bool = True


class ProcessDict(_AuditFieldsMixin):
    """Справочник бизнес-процессов."""

    id: int | None = None
    process_code: str
    process_name: str
    block_owner: str = ""
    department_owner: str = ""


class TerbankDict(_AuditFieldsMixin):
    """Справочник территориальных банков."""

    tb_id: int
    short_name: str
    full_name: str = ""


class GosbDict(_AuditFieldsMixin):
    """Справочник ГОСБов."""

    gosb_id: int
    gosb_name: str


class VspDict(_AuditFieldsMixin):
    """Справочник ВСП."""

    vsp_id: int
    vsp_urf_code: str = ""
    vsp_type: str = ""


class ChannelDict(_AuditFieldsMixin):
    """Справочник каналов."""

    id: int | None = None
    channel: str


class ProductDict(_AuditFieldsMixin):
    """Справочник продуктов."""

    id: int | None = None
    product_name: str


class SubsidiaryDict(_AuditFieldsMixin):
    """Справочник дочерних компаний."""

    id: int | None = None
    subsidiary_group: str = ""
    subsidiary_name: str


class ViolationMetricDict(_AuditFieldsMixin):
    """Справочник метрик нарушений."""

    id: int | None = None
    code: str
    metric_name: str


class TeamDict(_AuditFieldsMixin):
    """Справочник команд."""

    id: int | None = None
    tb_id: int | None = None
    username: str
