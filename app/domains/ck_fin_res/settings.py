"""Настройки домена ЦК Фин.Рез."""

from pydantic import BaseModel


class CkFinResSettings(BaseModel):
    """Корневая модель настроек домена ЦК Фин.Рез."""

    schema_name: str = ""

    fr_validation_table: str = "t_db_oarb_ck_fr_validation"
    fr_validation_view: str = "v_db_oarb_ck_fr_validation"

    # Верхняя граница рабочего набора (записей), который грузится в память для
    # client-mode таблицы. Свыше — таблица переходит в server-mode. Также
    # ограничивает максимальный limit страницы поиска.
    working_set_cap: int = 1000
