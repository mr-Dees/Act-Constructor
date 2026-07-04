"""Настройки домена ЦК Клиентский опыт."""

from pydantic import BaseModel


class CkClientExpSettings(BaseModel):
    """Корневая модель настроек домена ЦК Клиентский опыт."""

    schema_name: str = ""

    cs_validation_table: str = "t_db_oarb_ck_cs_validation"
    cs_validation_view: str = "v_db_oarb_ck_cs_validation"

    # Верхняя граница рабочего набора (записей), который грузится в память для
    # client-mode таблицы. Свыше — таблица переходит в server-mode. Также
    # ограничивает максимальный limit страницы поиска.
    working_set_cap: int = 1000
