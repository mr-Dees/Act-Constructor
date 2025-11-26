"""
Модуль извлечения данных актов для AI-ассистента.

Предоставляет детерминированные функции для получения данных
из PostgreSQL в человекочитаемом формате.
"""

from app.extractors.api import (
    get_act_by_km,
    get_acts_by_km_list,
    get_act_structure,
    get_item_by_number,
    get_items_by_number_list,
    get_all_tables_in_item,
    get_tables_by_item_list,
    get_table_by_name,
    get_all_violations,
    get_violation_by_item,
    get_violations_by_item_list,
    get_violation_fields,
)

__all__ = [
    'get_act_by_km',
    'get_acts_by_km_list',
    'get_act_structure',
    'get_item_by_number',
    'get_items_by_number_list',
    'get_all_tables_in_item',
    'get_tables_by_item_list',
    'get_table_by_name',
    'get_all_violations',
    'get_violation_by_item',
    'get_violations_by_item_list',
    'get_violation_fields',
]
