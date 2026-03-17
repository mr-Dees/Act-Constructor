"""
Маппинг AI-функций актов в ChatTool для OpenAI function-calling.

Каждая из 27 экспортируемых функций ai_assistant получает
ChatTool-обёртку с типизированными параметрами.
"""

from app.core.chat_tools import ChatTool, ChatToolParam

_DOMAIN = "acts"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает список ChatTool для домена актов."""
    from app.domains.acts.integrations.ai_assistant import (
        search_acts,
        get_act_by_km,
        get_acts_by_km_list,
        get_act_structure,
        get_act_structures_batch,
        get_item_by_number,
        get_items_by_number_list,
        get_all_violations,
        get_all_violations_batch,
        get_violation_by_item,
        get_violations_by_item_list,
        get_violation_fields,
        get_violation_fields_batch,
        get_all_tables,
        get_all_tables_batch,
        get_all_tables_in_item,
        get_tables_by_item_list,
        get_table_by_name,
        get_tables_by_name_batch,
        get_all_textblocks,
        get_all_textblocks_batch,
        get_textblocks_by_item,
        get_textblocks_by_item_list,
        get_all_invoices,
        get_all_invoices_batch,
        get_invoices_by_item,
        get_invoices_by_item_list,
    )

    return [
        # ── Поиск ──
        ChatTool(
            name="acts.search_acts",
            domain=_DOMAIN,
            description=(
                "Поиск и фильтрация актов проверок по различным критериям: "
                "дата приказа, город, название проверки, номер поручения. "
                "Возвращает отформатированный список найденных актов."
            ),
            parameters=[
                ChatToolParam("inspection_names", "array", "Список названий проверок (частичное совпадение)", required=False),
                ChatToolParam("cities", "array", "Список городов", required=False),
                ChatToolParam("created_date_from", "string", "Дата составления от (формат YYYY-MM-DD)", required=False),
                ChatToolParam("created_date_to", "string", "Дата составления до (YYYY-MM-DD)", required=False),
                ChatToolParam("order_date_from", "string", "Дата приказа от (YYYY-MM-DD)", required=False),
                ChatToolParam("order_date_to", "string", "Дата приказа до (YYYY-MM-DD)", required=False),
                ChatToolParam("inspection_start_from", "string", "Начало проверки от (YYYY-MM-DD)", required=False),
                ChatToolParam("inspection_start_to", "string", "Начало проверки до (YYYY-MM-DD)", required=False),
                ChatToolParam("inspection_end_from", "string", "Окончание проверки от (YYYY-MM-DD)", required=False),
                ChatToolParam("inspection_end_to", "string", "Окончание проверки до (YYYY-MM-DD)", required=False),
                ChatToolParam("directive_numbers", "array", "Номера поручений", required=False),
                ChatToolParam("with_metadata", "boolean", "Включать подробные метаданные", required=False, default=True),
            ],
            handler=search_acts,
            category="search",
        ),

        # ── Полное содержимое актов ──
        ChatTool(
            name="acts.get_act_by_km",
            domain=_DOMAIN,
            description=(
                "Получить полное содержимое акта по номеру КМ. "
                "Включает метаданные, аудиторскую группу, поручения "
                "и все элементы контента."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта (например, КМ-18-00001)"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=True),
            ],
            handler=get_act_by_km,
            category="extract",
        ),
        ChatTool(
            name="acts.get_acts_by_km_list",
            domain=_DOMAIN,
            description="Получить несколько актов по списку номеров КМ батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=True),
            ],
            handler=get_acts_by_km_list,
            category="extract",
        ),

        # ── Структура актов ──
        ChatTool(
            name="acts.get_act_structure",
            domain=_DOMAIN,
            description=(
                "Получить структуру акта в виде дерева пунктов. "
                "Иерархическое представление с опциональной статистикой."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("with_statistics", "boolean", "Включать статистику по содержимому", required=False, default=False),
            ],
            handler=get_act_structure,
            category="extract",
        ),
        ChatTool(
            name="acts.get_act_structures_batch",
            domain=_DOMAIN,
            description="Получить структуры нескольких актов батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_statistics", "boolean", "Включать статистику", required=False, default=False),
            ],
            handler=get_act_structures_batch,
            category="extract",
        ),

        # ── Пункты ──
        ChatTool(
            name="acts.get_item_by_number",
            domain=_DOMAIN,
            description=(
                "Получить конкретный пункт акта по номеру КМ и номеру пункта. "
                "Поддерживает рекурсивное включение подпунктов."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта (например, 1.2.3)"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
                ChatToolParam("max_depth", "integer", "Максимальная глубина рекурсии", required=False),
            ],
            handler=get_item_by_number,
            category="extract",
        ),
        ChatTool(
            name="acts.get_items_by_number_list",
            domain=_DOMAIN,
            description="Получить несколько пунктов акта батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_items_by_number_list,
            category="extract",
        ),

        # ── Нарушения ──
        ChatTool(
            name="acts.get_all_violations",
            domain=_DOMAIN,
            description=(
                "Получить все нарушения из акта по номеру КМ. "
                "Каждое нарушение включает указание родительского пункта."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_violations,
            category="extract",
        ),
        ChatTool(
            name="acts.get_all_violations_batch",
            domain=_DOMAIN,
            description="Получить все нарушения по списку КМ батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_violations_batch,
            category="extract",
        ),
        ChatTool(
            name="acts.get_violation_by_item",
            domain=_DOMAIN,
            description=(
                "Получить нарушения по конкретному пункту акта. "
                "Опционально включает подпункты."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_violation_by_item,
            category="extract",
        ),
        ChatTool(
            name="acts.get_violations_by_item_list",
            domain=_DOMAIN,
            description="Получить нарушения по списку пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_violations_by_item_list,
            category="extract",
        ),
        ChatTool(
            name="acts.get_violation_fields",
            domain=_DOMAIN,
            description=(
                "Получить определённые поля нарушений пункта акта. "
                "Доступные поля: violated, established, case, image, "
                "freeText, additional_content, responsible, consequences, "
                "reasons, recommendations."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("field_names", "array", "Список имён полей для извлечения"),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_violation_fields,
            category="extract",
        ),
        ChatTool(
            name="acts.get_violation_fields_batch",
            domain=_DOMAIN,
            description="Получить конкретные поля нарушений по списку пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("field_names", "array", "Список имён полей"),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_violation_fields_batch,
            category="extract",
        ),

        # ── Таблицы ──
        ChatTool(
            name="acts.get_all_tables",
            domain=_DOMAIN,
            description=(
                "Получить все таблицы из акта по номеру КМ. "
                "Таблицы форматируются в Markdown с указанием родительского пункта."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_tables,
            category="extract",
        ),
        ChatTool(
            name="acts.get_all_tables_batch",
            domain=_DOMAIN,
            description="Получить все таблицы по списку КМ батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_tables_batch,
            category="extract",
        ),
        ChatTool(
            name="acts.get_all_tables_in_item",
            domain=_DOMAIN,
            description=(
                "Получить все таблицы по пункту акта. "
                "Опционально включает таблицы из подпунктов."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_all_tables_in_item,
            category="extract",
        ),
        ChatTool(
            name="acts.get_tables_by_item_list",
            domain=_DOMAIN,
            description="Получить таблицы по списку пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_tables_by_item_list,
            category="extract",
        ),
        ChatTool(
            name="acts.get_table_by_name",
            domain=_DOMAIN,
            description=(
                "Найти таблицу по частичному названию в пункте акта. "
                "Поиск через ILIKE (частичное совпадение)."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("table_name", "string", "Частичное название таблицы для поиска"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_table_by_name,
            category="extract",
        ),
        ChatTool(
            name="acts.get_tables_by_name_batch",
            domain=_DOMAIN,
            description="Найти таблицы по названию для списка пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("table_name", "string", "Частичное название таблицы"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_tables_by_name_batch,
            category="extract",
        ),

        # ── Текстовые блоки ──
        ChatTool(
            name="acts.get_all_textblocks",
            domain=_DOMAIN,
            description=(
                "Получить все текстовые блоки из акта по номеру КМ. "
                "Каждый блок включает указание родительского пункта."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_textblocks,
            category="extract",
        ),
        ChatTool(
            name="acts.get_all_textblocks_batch",
            domain=_DOMAIN,
            description="Получить все текстовые блоки по списку КМ батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_textblocks_batch,
            category="extract",
        ),
        ChatTool(
            name="acts.get_textblocks_by_item",
            domain=_DOMAIN,
            description=(
                "Получить текстовые блоки по пункту акта. "
                "Опционально включает блоки из подпунктов."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_textblocks_by_item,
            category="extract",
        ),
        ChatTool(
            name="acts.get_textblocks_by_item_list",
            domain=_DOMAIN,
            description="Получить текстовые блоки по списку пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_textblocks_by_item_list,
            category="extract",
        ),

        # ── Фактуры ──
        ChatTool(
            name="acts.get_all_invoices",
            domain=_DOMAIN,
            description=(
                "Получить все фактуры из акта по номеру КМ. "
                "Каждая фактура включает указание родительского пункта."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_invoices,
            category="extract",
        ),
        ChatTool(
            name="acts.get_all_invoices_batch",
            domain=_DOMAIN,
            description="Получить все фактуры по списку КМ батчем.",
            parameters=[
                ChatToolParam("km_numbers", "array", "Список номеров КМ"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
            ],
            handler=get_all_invoices_batch,
            category="extract",
        ),
        ChatTool(
            name="acts.get_invoices_by_item",
            domain=_DOMAIN,
            description=(
                "Получить фактуры по пункту акта. "
                "Опционально включает фактуры из подпунктов."
            ),
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_number", "string", "Номер пункта"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_invoices_by_item,
            category="extract",
        ),
        ChatTool(
            name="acts.get_invoices_by_item_list",
            domain=_DOMAIN,
            description="Получить фактуры по списку пунктов батчем.",
            parameters=[
                ChatToolParam("km_number", "string", "Номер КМ акта"),
                ChatToolParam("item_numbers", "array", "Список номеров пунктов"),
                ChatToolParam("with_metadata", "boolean", "Включать метаданные", required=False, default=False),
                ChatToolParam("recursive", "boolean", "Включать подпункты", required=False, default=True),
            ],
            handler=get_invoices_by_item_list,
            category="extract",
        ),
    ]
