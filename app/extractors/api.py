"""
Детерминированные функции для извлечения и форматирования данных актов.
"""

from datetime import date
from typing import List, Dict, Optional

from app.extractors.connection import get_extractor_connection
from app.extractors.filters import ActFilters
from app.extractors.formatters import ActFormatter
from app.extractors.queries import ActQueries


# ============================================================================
# ПОИСК И ФИЛЬТРАЦИЯ АКТОВ
# ============================================================================

async def search_acts(
        inspection_names: Optional[List[str]] = None,
        cities: Optional[List[str]] = None,
        created_date_from: Optional[date] = None,
        created_date_to: Optional[date] = None,
        order_date_from: Optional[date] = None,
        order_date_to: Optional[date] = None,
        inspection_start_from: Optional[date] = None,
        inspection_start_to: Optional[date] = None,
        inspection_end_from: Optional[date] = None,
        inspection_end_to: Optional[date] = None,
        directive_numbers: Optional[List[str]] = None,
        with_metadata: bool = True
) -> str:
    """
    Поиск актов по набору фильтров.

    Args:
        inspection_names: Список названий проверок (частичное совпадение)
        cities: Список городов (частичное совпадение)
        created_date_from: Дата составления от
        created_date_to: Дата составления до
        order_date_from: Дата приказа от
        order_date_to: Дата приказа до
        inspection_start_from: Дата начала проверки от
        inspection_start_to: Дата начала проверки до
        inspection_end_from: Дата окончания проверки от
        inspection_end_to: Дата окончания проверки до
        directive_numbers: Список номеров поручений
        with_metadata: Включать подробные метаданные

    Returns:
        Отформатированный список актов
    """
    async with get_extractor_connection() as conn:
        results = await ActFilters.search_acts(
            conn,
            inspection_names=inspection_names,
            cities=cities,
            created_date_from=created_date_from,
            created_date_to=created_date_to,
            order_date_from=order_date_from,
            order_date_to=order_date_to,
            inspection_start_from=inspection_start_from,
            inspection_start_to=inspection_start_to,
            inspection_end_from=inspection_end_from,
            inspection_end_to=inspection_end_to,
            directive_numbers=directive_numbers,
            with_metadata=with_metadata
        )

        return ActFilters.format_search_results(results, with_metadata)


# ============================================================================
# СТРУКТУРА АКТОВ
# ============================================================================

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


async def get_act_structures_batch(
        km_numbers: List[str],
        with_statistics: bool = False
) -> Dict[str, str]:
    """
    Получить структуры нескольких актов.

    Args:
        km_numbers: Список КМ номеров
        with_statistics: Подсчитать количество блоков

    Returns:
        Словарь {КМ: структура акта}
    """
    result = {}
    for km in km_numbers:
        structure = await get_act_structure(km, with_statistics)
        result[km] = structure
    return result


# ============================================================================
# ПОЛНОЕ СОДЕРЖИМОЕ АКТОВ
# ============================================================================

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
            content = ActFormatter.format_tree_item(
                tree, tree, tables, textblocks, violations
            )
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


# ============================================================================
# ИЗВЛЕЧЕНИЕ ПУНКТОВ
# ============================================================================

async def get_item_by_number(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True,
        max_depth: Optional[int] = None
) -> str | Dict[str, str]:
    """
    Получить конкретный пункт (или несколько пунктов) по КМ и номеру.

    Args:
        km_number: КМ
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2", "5.3"])
        with_metadata: Включить метаданные в начало результата
        recursive: True — включить подпункты, False — только указанный уровень
        max_depth: Глубина рекурсии (None — всё дерево, работает только при recursive=True)

    Returns:
        Если item_number - str: человекочитаемый пункт
        Если item_number - List[str]: Dict[str, str] - {номер_пункта: содержимое}
    """
    # Если передан список - вызываем batch функцию
    if isinstance(item_number, list):
        return await get_items_by_number_list(
            km_number, item_number, with_metadata, recursive
        )

    # Одиночный пункт - существующая логика
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        if not tree:
            return "Структура акта не найдена."

        # Поиск нужного узла по номеру
        def _find_by_number(node, number):
            # Сравниваем без точки в конце
            node_num = node.get('number', '').rstrip('.')
            search_num = number.rstrip('.')

            if node_num == search_num:
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

        # Если не рекурсивно — оставляем только прямые дочерние информационные узлы
        if not recursive:
            # Создаем копию узла
            target_copy = dict(target)

            # Фильтруем детей: оставляем только информационные узлы (не пункты)
            filtered_children = [
                child for child in target.get('children', [])
                if child.get('type') in ['table', 'textblock', 'violation']
            ]
            target_copy['children'] = filtered_children

            # Форматируем с max_depth=1 чтобы не уходить глубже
            parts.append(
                ActFormatter.format_tree_item(
                    target_copy, tree, tables, textblocks, violations,
                    level=0, max_depth=1, parent_item_number=""
                )
            )
        else:
            # Рекурсивный режим - показываем всё дерево
            parts.append(
                ActFormatter.format_tree_item(
                    target, tree, tables, textblocks, violations,
                    level=0, max_depth=max_depth, parent_item_number=""
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


# ============================================================================
# ИЗВЛЕЧЕНИЕ НАРУШЕНИЙ
# ============================================================================

async def get_all_violations(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """Получить все нарушения по КМ-акту."""
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        violations = await ActQueries.get_all_violations(conn, act['id'], tree)

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not violations:
            parts.append(f"В акте КМ {km_number} нет нарушений.")
        else:
            # Строим маппинг node_id -> parent_item_number
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for v in violations:
                # Находим родительский пункт
                parent_number = ActQueries._find_parent_item_number(
                    tree, v.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_violation(v, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_all_violations_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все нарушения по списку КМ.

    Args:
        km_numbers: Список КМ
        with_metadata: Включить метаданные

    Returns:
        Словарь {КМ: нарушения}
    """
    result = {}
    for km in km_numbers:
        violations = await get_all_violations(km, with_metadata)
        result[km] = violations
    return result


async def get_violation_by_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить нарушения по конкретному пункту (или нескольким пунктам) КМ.

    Args:
        km_number: КМ номер
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2"])
        with_metadata: Включить метаданные (default: False)
        recursive: Искать в подпунктах (default: True)

    Returns:
        Если item_number - str: нарушения в пункте
        Если item_number - List[str]: Dict[str, str] - {номер_пункта: нарушения}
    """
    # Если передан список - вызываем batch функцию
    if isinstance(item_number, list):
        return await get_violations_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    # Одиночный пункт - существующая логика
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

        if not violations:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет нарушений.")
        else:
            # Строим маппинг
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for v in violations:
                parent_number = ActQueries._find_parent_item_number(
                    tree, v.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_violation(v, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_violations_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить нарушения по списку пунктов батчем.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: текст нарушений}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_violation_by_item(km_number, item_num, with_metadata, recursive)
        result[item_num] = text
    return result


async def get_violation_fields(
        km_number: str,
        item_number: str | List[str],
        field_names: List[str],
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить определённые поля всех нарушений пункта (или нескольких пунктов) КМ.

    Args:
        km_number: КМ номер
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2"])
        field_names: Список имен полей для извлечения
        recursive: Искать в подпунктах (default: True)

    Available field_names:
        Базовые текстовые поля:
        - "violated" - что нарушено
        - "established" - что установлено

        Дополнительный контент (можно по отдельности):
        - "case" - кейсы
        - "image" - изображения с подписями и именами файлов
        - "freeText" - свободный текст
        - "additional_content" - ВСЕ элементы дополнительного контента разом

        Опциональные блоки:
        - "responsible" - ответственные лица
        - "consequences" - последствия
        - "reasons" - причины
        - "recommendations" - рекомендации

    Returns:
        Если item_number - str: строка с полями нарушений
        Если item_number - List[str]: Dict[str, str] - {номер_пункта: поля нарушений}
    """
    # Если передан список - вызываем batch функцию
    if isinstance(item_number, list):
        return await get_violation_fields_batch(
            km_number, item_number, field_names, recursive
        )

    # Одиночный пункт - существующая логика
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        violations = await ActQueries.get_violations_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        if not violations:
            scope = "и подпунктах" if recursive else ""
            return f"В пункте {item_number} {scope} нет нарушений."

        # Строим маппинг node_id -> parent_item_number
        node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

        # Проверяем валидность полей
        valid_fields = {
            "violated", "established",
            "case", "image", "freeText", "additional_content",
            "responsible", "consequences", "reasons", "recommendations"
        }
        invalid_fields = [f for f in field_names if f not in valid_fields]
        if invalid_fields:
            return f"Неизвестные поля: {', '.join(invalid_fields)}. Доступные: {', '.join(sorted(valid_fields))}"

        parts = []
        for idx, v in enumerate(violations, 1):
            # Находим родительский пункт нарушения
            parent_number = ActQueries._find_parent_item_number(
                tree, v.get('node_id'), node_id_to_number
            )
            parent_info = f"пункт {parent_number}" if parent_number else "N/A"

            violation_parts = []
            violation_header = f"Нарушение {idx} ({parent_info})"

            for field_name in field_names:
                # Базовые текстовые поля
                if field_name == "violated":
                    violated = v.get('violated', '').strip()
                    if violated:
                        violation_parts.append(f"  Нарушено: {violated}")

                elif field_name == "established":
                    established = v.get('established', '').strip()
                    if established:
                        violation_parts.append(f"  Установлено: {established}")

                # Весь дополнительный контент разом
                elif field_name == "additional_content":
                    add_content = ActFormatter._parse_json_field(v.get("additional_content"))
                    if add_content and add_content.get("enabled"):
                        items = add_content.get("items", [])

                        if items:
                            violation_parts.append("  Дополнительный контент:")

                            for item_idx, item in enumerate(items, 1):
                                item_type = item.get("type", "unknown")

                                if item_type == "case":
                                    violation_parts.append(
                                        f"    Кейс {item_idx}: {item.get('content', '')}"
                                    )
                                elif item_type == "image":
                                    violation_parts.append(
                                        f"    Изображение {item_idx}: {item.get('caption', 'Без подписи')} "
                                        f"(файл: {item.get('filename', 'unknown')})"
                                    )
                                elif item_type == "freeText":
                                    violation_parts.append(
                                        f"    Текст {item_idx}: {item.get('content', '')}"
                                    )

                # Конкретные типы из дополнительного контента
                elif field_name in ("case", "image", "freeText"):
                    add_content = ActFormatter._parse_json_field(v.get("additional_content"))
                    if add_content and add_content.get("enabled"):
                        items = [item for item in add_content.get("items", [])
                                 if item.get("type") == field_name]

                        if items:
                            field_labels = {
                                "case": "Кейс",
                                "image": "Изображение",
                                "freeText": "Текст"
                            }
                            label = field_labels.get(field_name, field_name)

                            for item_idx, item in enumerate(items, 1):
                                if field_name == "case":
                                    violation_parts.append(
                                        f"  {label} {item_idx}: {item.get('content', '')}"
                                    )
                                elif field_name == "image":
                                    violation_parts.append(
                                        f"  {label} {item_idx}: {item.get('caption', 'Без подписи')} "
                                        f"(файл: {item.get('filename', 'unknown')})"
                                    )
                                elif field_name == "freeText":
                                    violation_parts.append(
                                        f"  {label} {item_idx}: {item.get('content', '')}"
                                    )

                # Опциональные текстовые поля
                elif field_name in ["responsible", "consequences", "reasons", "recommendations"]:
                    value = ActFormatter._parse_json_field(v.get(field_name))
                    if value and value.get("enabled"):
                        content = value.get("content", '').strip()
                        if content:
                            field_label = {
                                "responsible": "Ответственные",
                                "consequences": "Последствия",
                                "reasons": "Причины",
                                "recommendations": "Рекомендации"
                            }.get(field_name, field_name.capitalize())

                            violation_parts.append(f"  {field_label}: {content}")

            # Добавляем нарушение только если есть хотя бы одно поле
            if violation_parts:
                parts.append(violation_header)
                parts.extend(violation_parts)
                parts.append("")  # Пустая строка между нарушениями

        if not parts:
            fields_str = ', '.join(field_names)
            return f"В пункте {item_number} нет указанных полей ({fields_str}) в нарушениях."

        return "\n".join(parts)


async def get_violation_fields_batch(
        km_number: str,
        item_numbers: List[str],
        field_names: List[str],
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить конкретные поля нарушений по списку пунктов.

    Args:
        km_number: КМ номер
        item_numbers: Список номеров пунктов
        field_names: Список имен полей для извлечения
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: поля нарушений}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_violation_fields(km_number, item_num, field_names, recursive)
        result[item_num] = text
    return result


# ============================================================================
# ИЗВЛЕЧЕНИЕ ТАБЛИЦ
# ============================================================================

async def get_all_tables(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """
    Получить все таблицы по КМ.

    Args:
        km_number: КМ
        with_metadata: Включить метаданные

    Returns:
        Все таблицы (Markdown)
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        tables = await ActQueries.get_all_tables(conn, act['id'], tree)

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not tables:
            parts.append(f"В акте КМ {km_number} нет таблиц.")
        else:
            # Строим маппинг node_id -> parent_item_number
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for t in tables:
                # Находим родительский пункт
                parent_number = ActQueries._find_parent_item_number(
                    tree, t.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_table(t, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_all_tables_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все таблицы по списку КМ.

    Args:
        km_numbers: Список КМ
        with_metadata: Включить метаданные

    Returns:
        Словарь {КМ: таблицы}
    """
    result = {}
    for km in km_numbers:
        tables = await get_all_tables(km, with_metadata)
        result[km] = tables
    return result


async def get_all_tables_in_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить все таблицы по пункту (или нескольким пунктам) для заданного КМ.

    Args:
        km_number: КМ
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2"])
        with_metadata: Включить метаданные
        recursive: True — включить подпункты, False — только указанный уровень

    Returns:
        Если item_number - str: Markdown-таблицы
        Если item_number - List[str]: Dict[str, str] - {номер_пункта: таблицы}
    """
    # Если передан список - вызываем batch функцию
    if isinstance(item_number, list):
        return await get_tables_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    # Одиночный пункт - существующая логика
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        tables = await ActQueries.get_tables_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not tables:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет таблиц.")
        else:
            # Строим маппинг node_id -> parent_item_number
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for t in tables:
                # Находим родительский пункт
                parent_number = ActQueries._find_parent_item_number(
                    tree, t.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_table(t, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_tables_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить таблицы по списку пунктов батчем.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: таблицы}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_all_tables_in_item(km_number, item_num, with_metadata, recursive)
        result[item_num] = text
    return result


async def get_table_by_name(
        km_number: str,
        item_number: str | List[str],
        table_name: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str] | Dict[str, Dict[str, str]]:
    """
    Получить таблицу по частичному названию для пункта КМ.

    Args:
        km_number: КМ номер
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2"])
        table_name: название таблицы ("метрик") или список названий (["метрик", "риск"])
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Варианты возврата:
        1. item_number=str, table_name=str → str (одна таблица)
        2. item_number=str, table_name=List[str] → Dict[str, str] ({название: таблица})
        3. item_number=List[str], table_name=str → Dict[str, str] ({пункт: таблица})
        4. item_number=List[str], table_name=List[str] → Dict[str, Dict[str, str]]
           ({пункт: {название: таблица}})
    """
    # Случай 4: Оба параметра - списки
    if isinstance(item_number, list) and isinstance(table_name, list):
        result = {}
        for item_num in item_number:
            item_result = await get_table_by_name(
                km_number, item_num, table_name, with_metadata, recursive
            )
            result[item_num] = item_result
        return result

    # Случай 3: item_number - список, table_name - строка
    if isinstance(item_number, list):
        return await get_tables_by_name_batch(
            km_number, item_number, table_name, with_metadata, recursive
        )

    # Случай 2: item_number - строка, table_name - список
    if isinstance(table_name, list):
        result = {}
        async with get_extractor_connection() as conn:
            act = await ActQueries.get_act_metadata(conn, km_number)
            if not act:
                return f"Акт с КМ {km_number} не найден."

            tree = await ActQueries.get_tree(conn, act['id'])

            for name in table_name:
                table = await ActQueries.get_table_by_name(
                    conn, act['id'], item_number, name, tree, recursive
                )

                if not table:
                    scope = "и подпунктах" if recursive else ""
                    result[name] = f"В пункте {item_number} {scope} КМ {km_number} нет таблицы с названием '{name}'."
                else:
                    # Строим маппинг и находим родительский пункт
                    node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)
                    parent_number = ActQueries._find_parent_item_number(
                        tree, table.get('node_id'), node_id_to_number
                    )

                    parts = []
                    if with_metadata and name == table_name[0]:  # Метаданные только один раз
                        parts.append(ActFormatter.format_metadata(act))

                    parts.append(ActFormatter.format_table(table, parent_number or ""))
                    result[name] = "\n\n".join(p for p in parts if p.strip())

        return result

    # Случай 1: Оба параметра - строки (существующая логика)
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        table = await ActQueries.get_table_by_name(
            conn, act['id'], item_number, table_name, tree, recursive
        )

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not table:
            scope = "и подпунктах" if recursive else ""
            parts.append(
                f"В пункте {item_number} {scope} КМ {km_number} нет таблицы с названием, содержащим '{table_name}'."
            )
        else:
            # Строим маппинг и находим родительский пункт
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)
            parent_number = ActQueries._find_parent_item_number(
                tree, table.get('node_id'), node_id_to_number
            )
            parts.append(ActFormatter.format_table(table, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_tables_by_name_batch(
        km_number: str,
        item_numbers: List[str],
        table_name: str,
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить таблицы по названию для списка пунктов.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        table_name: Название таблицы
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: таблица}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_table_by_name(km_number, item_num, table_name, with_metadata, recursive)
        result[item_num] = text
    return result


# ============================================================================
# ИЗВЛЕЧЕНИЕ ТЕКСТОВЫХ БЛОКОВ
# ============================================================================

async def get_all_textblocks(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """
    Получить все текстовые блоки по КМ.

    Args:
        km_number: КМ
        with_metadata: Включить метаданные

    Returns:
        Все текстовые блоки
    """
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])
        textblocks = await ActQueries.get_all_textblocks(conn, act['id'], tree)

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not textblocks:
            parts.append(f"В акте КМ {km_number} нет текстовых блоков.")
        else:
            # Строим маппинг node_id -> parent_item_number
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for tb in textblocks:
                # Находим родительский пункт
                parent_number = ActQueries._find_parent_item_number(
                    tree, tb.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_textblock(tb, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_all_textblocks_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все текстовые блоки по списку КМ.

    Args:
        km_numbers: Список КМ
        with_metadata: Включить метаданные

    Returns:
        Словарь {КМ: текстовые блоки}
    """
    result = {}
    for km in km_numbers:
        textblocks = await get_all_textblocks(km, with_metadata)
        result[km] = textblocks
    return result


async def get_textblocks_by_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить текстовые блоки по пункту (или нескольким пунктам) и КМ.

    Args:
        km_number: КМ
        item_number: номер пункта ("5.1") или список номеров (["5.1", "5.2"])
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Если item_number - str: текстовые блоки
        Если item_number - List[str]: Dict[str, str] - {номер_пункта: текстовые блоки}
    """
    # Если передан список - вызываем batch функцию
    if isinstance(item_number, list):
        return await get_textblocks_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    # Одиночный пункт - существующая логика
    async with get_extractor_connection() as conn:
        act = await ActQueries.get_act_metadata(conn, km_number)
        if not act:
            return f"Акт с КМ {km_number} не найден."

        tree = await ActQueries.get_tree(conn, act['id'])

        # Используем новый метод
        textblocks = await ActQueries.get_textblocks_by_item(
            conn, act['id'], item_number, tree, recursive
        )

        parts = []
        if with_metadata:
            parts.append(ActFormatter.format_metadata(act))

        if not textblocks:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет текстовых блоков.")
        else:
            # Строим маппинг node_id -> parent_item_number
            node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

            for tb in textblocks:
                # Находим родительский пункт
                parent_number = ActQueries._find_parent_item_number(
                    tree, tb.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_textblock(tb, parent_number or ""))

        return "\n\n".join(p for p in parts if p.strip())


async def get_textblocks_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить текстовые блоки по списку пунктов.

    Args:
        km_number: КМ
        item_numbers: Список номеров пунктов
        with_metadata: Включить метаданные
        recursive: Искать в подпунктах

    Returns:
        Словарь {номер_пункта: текстовые блоки}
    """
    result = {}
    for item_num in item_numbers:
        text = await get_textblocks_by_item(km_number, item_num, with_metadata, recursive)
        result[item_num] = text
    return result
