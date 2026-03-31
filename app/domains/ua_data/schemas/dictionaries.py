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
    """Справочник процессов."""

    id: int | None = None
    process_code: str
    process_name: str
    description: str | None = None


class TerbankDict(_AuditFieldsMixin):
    """Справочник территориальных банков."""

    id: int | None = None
    terbank_code: str
    terbank_name: str
    short_name: str | None = None


class GosbDict(_AuditFieldsMixin):
    """Справочник ГОСБов."""

    id: int | None = None
    gosb_code: str
    gosb_name: str
    terbank_id: int | None = None


class VspDict(_AuditFieldsMixin):
    """Справочник ВСП."""

    id: int | None = None
    vsp_code: str
    vsp_name: str
    gosb_id: int | None = None


class ChannelDict(_AuditFieldsMixin):
    """Справочник каналов."""

    id: int | None = None
    channel_code: str
    channel_name: str


class ProductDict(_AuditFieldsMixin):
    """Справочник продуктов."""

    id: int | None = None
    product_code: str
    product_name: str
    category: str | None = None


class SubsidiaryDict(_AuditFieldsMixin):
    """Справочник дочерних организаций."""

    id: int | None = None
    subsidiary_code: str
    subsidiary_name: str
    inn: str | None = None


class ViolationMetricDict(_AuditFieldsMixin):
    """Справочник метрик нарушений."""

    id: int | None = None
    metric_code: str
    metric_name: str
    metric_type: str | None = None
    description: str | None = None


class TeamDict(_AuditFieldsMixin):
    """Справочник команд аудита."""

    id: int | None = None
    team_code: str
    team_name: str
    leader_name: str | None = None
