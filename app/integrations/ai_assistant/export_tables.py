"""Извлечение таблиц актов."""

from typing import Dict, List

from app.db.connection import get_pool
from app.integrations.ai_assistant._helpers import (
    ActContext, build_node_map, find_parent_number,
    assemble_parts, prepend_metadata,
    batch_over_km, batch_over_items,
)
from app.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter
from app.integrations.ai_assistant.queries.act_queries import ActQueries


async def get_all_tables(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """
    Получить все таблицы по КМ.

    Извлекает все таблицы из акта с указанием родительского пункта для каждой
    таблицы. Таблицы форматируются в Markdown или текстовом виде в зависимости
    от наличия объединенных ячеек.

    Args:
        km_number: КМ номер акта.
        with_metadata: Включать ли метаданные акта в начало вывода.

    Returns:
        Отформатированный список таблиц (Markdown) или сообщение об отсутствии.
    """
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        tables = await ActQueries.get_all_tables(ctx.conn, ctx.act['id'], ctx.tree)

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not tables:
            parts.append(f"В акте КМ {km_number} нет таблиц.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for t in tables:
                parent_number = find_parent_number(
                    ctx.tree, t.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_table(t, parent_number or ""))

        return assemble_parts(parts)


async def get_all_tables_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все таблицы по списку КМ батчем.

    Args:
        km_numbers: Список КМ номеров актов.
        with_metadata: Включать ли метаданные для каждого акта.

    Returns:
        Словарь {КМ: таблицы}.
    """
    return await batch_over_km(
        km_numbers, get_all_tables, with_metadata=with_metadata
    )


async def get_all_tables_in_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить все таблицы по пункту (или нескольким пунктам) для заданного КМ.

    Извлекает таблицы, находящиеся в указанном пункте и опционально в его
    подпунктах.

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Если item_number - str: отформатированные таблицы (Markdown).
        Если item_number - List[str]: Dict[номер_пункта: таблицы].
    """
    if isinstance(item_number, list):
        return await get_tables_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        tables = await ActQueries.get_tables_by_item(
            ctx.conn, ctx.act['id'], item_number, ctx.tree, recursive
        )

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not tables:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет таблиц.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for t in tables:
                parent_number = find_parent_number(
                    ctx.tree, t.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_table(t, parent_number or ""))

        return assemble_parts(parts)


async def get_tables_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить таблицы по списку пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов.
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Словарь {номер_пункта: таблицы}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_all_tables_in_item,
        with_metadata=with_metadata, recursive=recursive,
    )


async def get_table_by_name(
        km_number: str,
        item_number: str | List[str],
        table_name: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str] | Dict[str, Dict[str, str]]:
    """
    Получить таблицу по частичному названию для пункта КМ.

    Выполняет поиск таблицы по частичному совпадению названия (ILIKE) в
    указанном пункте. Поддерживает batch-режим для множественных пунктов
    и/или названий.

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        table_name: Название таблицы ("метрик") или список названий (["метрик", "риск"]).
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Варианты возврата в зависимости от типов аргументов:
        1. item_number=str, table_name=str -> str (одна таблица)
        2. item_number=str, table_name=List[str] -> Dict[название: таблица]
        3. item_number=List[str], table_name=str -> Dict[пункт: таблица]
        4. item_number=List[str], table_name=List[str] -> Dict[пункт: Dict[название: таблица]]
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
        pool = get_pool()

        result = {}
        async with pool.acquire() as conn:
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
                    result[name] = (
                        f"В пункте {item_number} {scope} КМ {km_number} "
                        f"нет таблицы с названием '{name}'."
                    )
                else:
                    node_id_to_number = build_node_map(tree)
                    parent_number = find_parent_number(
                        tree, table.get('node_id'), node_id_to_number
                    )

                    parts = []

                    if with_metadata and name == table_name[0]:
                        parts.append(ActFormatter.format_metadata(act))

                    parts.append(ActFormatter.format_table(table, parent_number or ""))
                    result[name] = assemble_parts(parts)

        return result

    # Случай 1: Оба параметра - строки (основная логика)
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        table = await ActQueries.get_table_by_name(
            ctx.conn, ctx.act['id'], item_number, table_name, ctx.tree, recursive
        )

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not table:
            scope = "и подпунктах" if recursive else ""
            parts.append(
                f"В пункте {item_number} {scope} КМ {km_number} "
                f"нет таблицы с названием, содержащим '{table_name}'."
            )
        else:
            node_id_to_number = build_node_map(ctx.tree)
            parent_number = find_parent_number(
                ctx.tree, table.get('node_id'), node_id_to_number
            )
            parts.append(ActFormatter.format_table(table, parent_number or ""))

        return assemble_parts(parts)


async def get_tables_by_name_batch(
        km_number: str,
        item_numbers: List[str],
        table_name: str,
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить таблицы по названию для списка пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов.
        table_name: Название таблицы для поиска.
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Словарь {номер_пункта: таблица}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_table_by_name,
        table_name=table_name, with_metadata=with_metadata, recursive=recursive,
    )
