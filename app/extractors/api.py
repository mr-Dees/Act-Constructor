"""
Детерминированные функции для извлечения и форматирования данных актов.
"""

from typing import List, Dict, Optional

from app.extractors.connection import get_extractor_connection
from app.extractors.queries import ActQueries
from app.extractors.formatters import ActFormatter


async def get_act_by_km(
    km_number: str,
    with_metadata: bool = True
) -> str:
    """
    Получить весь акт по КМ как человекочитаемый текст.

    Args:
        km_number: Номер КМ
        with_metadata: True — включить метаданные акта в начало

    Returns:
        Полный текст акта (или описание ошибки)
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        tables = await ActQueries.get_all_tables(conn, act['id'], tree)
        textblocks = await ActQueries.get_all_textblocks(conn, act['id'], tree)
        violations = await ActQueries.get_all_violations(conn, act['id'], tree)

        parts = []

        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))
            team = await ActQueries.get_audit_team(conn, act['id'])
            directives = await ActQueries.get_directives(conn, act['id'])
            parts.append(ActFormatter.format_audit_team(team))
            if directives:
                parts.append(ActFormatter.format_directives(directives))

        if tree:
            content = ActFormatter.format_tree_item(tree, tree, tables, textblocks, violations)
            if content.strip():
                parts.append(content)

        return "\n\n".join(p for p in parts if p.strip())


async def get_acts_by_km_list(
    km_numbers: List[str],
    with_metadata: bool = True
) -> Dict[str, str]:
    """
    Получить несколько актов по списку КМ.

    Args:
        km_numbers: Список КМ номеров
        with_metadata: Включить ли метаданные

    Returns:
        Словарь {КМ: текст акта или описание ошибки}
    """
    result = {}
    for km in km_numbers:
        act_text = await get_act_by_km(km, with_metadata=with_metadata)
        result[km] = act_text
    return result


async def get_act_structure(
    km_number: str,
    with_statistics: bool = False
) -> str:
    """
    Получить структуру акта в виде дерева пунктов.

    Args:
        km_number: КМ номер
        with_statistics: Подсчитать количество блоков

    Returns:
        Дерево структуры (или описание ошибки)
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        if not tree:
            return "Структура акта не найдена."

        if with_statistics:
            tables = await ActQueries.get_all_tables(conn, act['id'], tree)
            textblocks = await ActQueries.get_all_textblocks(conn, act['id'], tree)
            violations = await ActQueries.get_all_violations(conn, act['id'], tree)

            return ActFormatter.format_tree_structure(
                tree,
                stats={
                    'tables': len(tables),
                    'textblocks': len(textblocks),
                    'violations': len(violations)
                }
            )

        return ActFormatter.format_tree_structure(tree)


async def get_item_by_number(
    km_number: str,
    item_number: str,
    with_metadata: bool = False,
    recursive: bool = True,
    max_depth: Optional[int] = None
) -> str:
    """
    Получить конкретный пункт (или раздел) по КМ и номеру.

    Args:
        km_number: КМ
        item_number: номер пункта ("5" для раздела, "5.1.3" — вложенный)
        with_metadata: Включить метаданные в начало результата
        recursive: True — включить подпункты, False — только указанный уровень
        max_depth: Глубина рекурсии (None — всё дерево, работает только при recursive=True)

    Returns:
        Человекочитаемый пункт или объяснение проблемы
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        if not tree:
            return "Структура акта не найдена."

        # Поиск нужного узла по номеру
        def _find_by_number(node, number):
            if node.get('number', '').rstrip('.') == number.rstrip('.'):
                return node
            for child in node.get('children', []):
                res = _find_by_number(child, number)
                if res is not None:
                    return res
            return None

        target = _find_by_number(tree, item_number)
        if not target:
            return f"Пункт с номером {item_number} не найден в КМ {km_number}"

        tables = await ActQueries.get_all_tables(conn, act['id'], tree)
        textblocks = await ActQueries.get_all_textblocks(conn, act['id'], tree)
        violations = await ActQueries.get_all_violations(conn, act['id'], tree)

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        # Если не рекурсивно — убираем детей
        if not recursive:
            target_copy = dict(target)
            target_copy['children'] = []
            parts.append(
                ActFormatter.format_tree_item(
                    target_copy, tree, tables, textblocks, violations, level=0, max_depth=1
                )
            )
        else:
            parts.append(
                ActFormatter.format_tree_item(
                    target, tree, tables, textblocks, violations, level=0, max_depth=max_depth
                )
            )

        return "\n\n".join(p for p in parts if p.strip())


async def get_items_by_number_list(
    km_number: str,
    item_numbers: List[str],
    with_metadata: bool = False,
    recursive: bool = True
) -> Dict[str, str]:
    """
    Получить несколько пунктов батчем.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        with_metadata: Включить метаданные
        recursive: Включить подпункты

    Returns:
        Словарь {номер_пункта: текст}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_item_by_number(km_number, item_num, with_metadata, recursive)
        result[item_num] = text
    return result


async def get_all_violations(
    km_number: str,
    with_metadata: bool = False
) -> str:
    """
    Получить все нарушения по КМ-акту.

    Args:
        km_number: КМ
        with_metadata: Включить метаданные

    Returns:
        Список нарушений (текст)
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        violations = await ActQueries.get_all_violations(conn, act['id'], tree)

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        for v in violations:
            parts.append(ActFormatter.format_violation(v, v.get('node_number')))

        return "\n\n".join(p for p in parts if p.strip())


async def get_violation_by_item(
    km_number: str,
    item_number: str,
    with_metadata: bool = False,
    recursive: bool = True
) -> str:
    """
    Получить нарушения по конкретному пункту КМ.

    Args:
        km_number: КМ
        item_number: номер пункта
        with_metadata: Включить метаданные
        recursive: True — искать в подпунктах, False — только в указанном

    Returns:
        Список нарушений (или описание ошибки)
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        violations = await ActQueries.get_violations_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        for v in violations:
            parts.append(ActFormatter.format_violation(v, v.get('node_number')))

        return "\n\n".join(p for p in parts if p.strip())


async def get_violations_by_item_list(
    km_number: str,
    item_numbers: List[str],
    recursive: bool = True
) -> Dict[str, str]:
    """
    Получить нарушения по списку пунктов батчем.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: текст нарушений}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_violation_by_item(km_number, item_num, False, recursive)
        result[item_num] = text
    return result


async def get_violation_field(
    km_number: str,
    item_number: str,
    field_name: str,
    recursive: bool = True
) -> str:
    """
    Получить определённое поле всех нарушений пункта КМ.

    Args:
        km_number: КМ
        item_number: номер пункта
        field_name: Имя поля ("case", "image", "responsible", "consequences", "reasons", "recommendations")
        recursive: Искать в подпунктах

    Returns:
        Строка с содержимым всех сущностей этого типа
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        violations = await ActQueries.get_violations_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        parts = []
        for v in violations:
            node_num = v.get('node_number', 'N/A')

            # Поля типа "case"/"image" — массивы/списки
            if field_name in ("case", "image"):
                add_content = ActFormatter._parse_json_field(v.get("additional_content"))
                if add_content and add_content.get("enabled"):
                    for item in add_content.get("items", []):
                        if item.get("type") == field_name:
                            if field_name == "case":
                                parts.append(f"[{node_num}] Кейс: {item.get('content')}")
                            elif field_name == "image":
                                parts.append(
                                    f"[{node_num}] Изображение: {item.get('caption')} (файл: {item.get('filename')})"
                                )
            # Поля типа "responsible", "consequences" — текстовые
            elif field_name in ["responsible", "consequences", "reasons", "recommendations"]:
                value = ActFormatter._parse_json_field(v.get(field_name))
                if value and value.get("enabled"):
                    content = value.get("content")
                    if content:
                        parts.append(f"[{node_num}] {field_name.capitalize()}: {content}")

        return "\n".join(parts) if parts else f"В пункте {item_number} нет сущности типа {field_name}"


async def get_all_tables_in_item(
    km_number: str,
    item_number: str,
    recursive: bool = True
) -> str:
    """
    Получить все таблицы по пункту для заданного КМ.

    Args:
        km_number: КМ
        item_number: номер пункта
        recursive: True — включить подпункты, False — только указанный уровень

    Returns:
        Markdown-таблицы в человеко-читаемом виде
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        tables = await ActQueries.get_tables_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        if not tables:
            scope = "и подпунктах" if recursive else ""
            return f"В пункте {item_number} {scope} КМ {km_number} нет таблиц."

        return "\n\n".join(
            ActFormatter.format_table(t, t.get("node_number", ""))
            for t in tables
        )


async def get_tables_by_item_list(
    km_number: str,
    item_numbers: List[str],
    recursive: bool = True
) -> Dict[str, str]:
    """
    Получить таблицы по списку пунктов батчем.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: таблицы}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_all_tables_in_item(km_number, item_num, recursive)
        result[item_num] = text
    return result


async def get_table_by_name(
    km_number: str,
    item_number: str,
    table_name: str,
    recursive: bool = True
) -> str:
    """
    Получить таблицу по частичному названию для пункта КМ.

    Args:
        km_number: КМ
        item_number: номер пункта
        table_name: часть названия таблицы
        recursive: Искать в подпунктах

    Returns:
        Markdown-таблица или строка ошибки
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        table = await ActQueries.get_table_by_name(
            conn, act['id'], item_number, table_name, tree, recursive
        )

        if not table:
            scope = "и подпунктах" if recursive else ""
            return f"В пункте {item_number} {scope} КМ {km_number} нет таблицы с названием, содержащим '{table_name}'."

        return ActFormatter.format_table(table, table.get("node_number", ""))
