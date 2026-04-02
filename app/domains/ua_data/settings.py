"""Настройки домена UA Data (справочные таблицы)."""

from pydantic import BaseModel


class UaDataSettings(BaseModel):
    """Имена справочных таблиц UA, настраиваемые через UA_DATA__* в .env."""

    schema_name: str = ""

    process_dict: str = "t_db_oarb_ua_process_dict"
    terbank_dict: str = "t_db_oarb_ua_terbank_dict"
    violation_metric_dict: str = "t_db_oarb_ua_violation_metric_dict"
    departments: str = "t_db_oarb_ua_departments"
    gosb_dict: str = "t_db_oarb_ua_gosb_dict"
    vsp_dict: str = "t_db_oarb_ua_vsp_dict"
    channel_dict: str = "t_db_oarb_ua_channel_dict"
    product_dict: str = "t_db_oarb_ua_product_dict"
    team_dict: str = "t_db_oarb_ua_team_dict"
