"""
Модуль извлечения данных актов для AI-ассистента БД ОАРБ.

Предоставляет детерминированные функции для получения данных
из PostgreSQL в человекочитаемом формате.
"""

from app.integrations.ai_assistant_bd_oarb.data_export import (
    # Поиск и фильтрация актов
    search_acts,

    # Структура актов
    get_act_structure,
    get_act_structures_batch,

    # Полное содержимое актов
    get_act_by_km,
    get_acts_by_km_list,

    # Извлечение пунктов
    get_item_by_number,
    get_items_by_number_list,

    # Извлечение нарушений
    get_all_violations,
    get_all_violations_batch,
    get_violation_by_item,
    get_violations_by_item_list,
    get_violation_fields,
    get_violation_fields_batch,

    # Извлечение таблиц
    get_all_tables,
    get_all_tables_batch,
    get_all_tables_in_item,
    get_tables_by_item_list,
    get_table_by_name,
    get_tables_by_name_batch,

    # Извлечение текстовых блоков
    get_all_textblocks,
    get_all_textblocks_batch,
    get_textblocks_by_item,
    get_textblocks_by_item_list,
)

__all__ = [
    # Поиск и фильтрация актов
    "search_acts",

    # Структура актов
    "get_act_structure",
    "get_act_structures_batch",

    # Полное содержимое актов
    "get_act_by_km",
    "get_acts_by_km_list",

    # Извлечение пунктов
    "get_item_by_number",
    "get_items_by_number_list",

    # Извлечение нарушений
    "get_all_violations",
    "get_all_violations_batch",
    "get_violation_by_item",
    "get_violations_by_item_list",
    "get_violation_fields",
    "get_violation_fields_batch",

    # Извлечение таблиц
    "get_all_tables",
    "get_all_tables_batch",
    "get_all_tables_in_item",
    "get_tables_by_item_list",
    "get_table_by_name",
    "get_tables_by_name_batch",

    # Извлечение текстовых блоков
    "get_all_textblocks",
    "get_all_textblocks_batch",
    "get_textblocks_by_item",
    "get_textblocks_by_item_list",
]
