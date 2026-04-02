"""Настройки домена ЦК Клиентский опыт."""

from pydantic import BaseModel


class CkClientExpSettings(BaseModel):
    """Корневая модель настроек домена ЦК Клиентский опыт."""

    schema_name: str = ""

    cs_validation_table: str = "t_db_oarb_ck_cs_validation"
    cs_validation_view: str = "v_db_oarb_ck_cs_validation"
