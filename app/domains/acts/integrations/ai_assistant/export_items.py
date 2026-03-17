"""Извлечение пунктов актов по номерам."""

from typing import Dict, List, Optional

from app.domains.acts.integrations.ai_assistant._helpers import (
    ActContext, assemble_parts, prepend_metadata,
    find_node_by_number, batch_over_items,
)
from app.domains.acts.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter
from app.domains.acts.integrations.ai_assistant.queries.act_queries import ActQueries


async def get_item_by_number(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True,
        max_depth: Optional[int] = None
) -> str | Dict[str, str]:
    """
    Получить конкретный пункт (или несколько пунктов) по КМ и номеру.

    Извлекает содержимое указанного пункта акта с возможностью рекурсивного
    включения подпунктов и ограничения глубины. Поддерживает batch-режим для
    извлечения нескольких пунктов за один вызов.

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        with_metadata: Включать ли метаданные акта в начало результата.
        recursive: Включать ли подпункты и вложенный контент.
        max_depth: Максимальная глубина рекурсии (None = без ограничений).
                  Работает только при recursive=True.

    Returns:
        Если item_number - str: отформатированное содержимое пункта.
        Если item_number - List[str]: Dict[номер_пункта: содержимое].
    """
    if isinstance(item_number, list):
        return await get_items_by_number_list(
            km_number, item_number, with_metadata, recursive
        )

    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        if not ctx.tree:
            return "Структура акта не найдена."

        target = find_node_by_number(ctx.tree, item_number)
        if not target:
            return f"Пункт с номером {item_number} не найден в КМ {km_number}"

        tables = await ActQueries.get_all_tables(ctx.conn, ctx.act['id'], ctx.tree)
        textblocks = await ActQueries.get_all_textblocks(ctx.conn, ctx.act['id'], ctx.tree)
        violations = await ActQueries.get_all_violations(ctx.conn, ctx.act['id'], ctx.tree)

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not recursive:
            target_copy = dict(target)
            filtered_children = [
                child for child in target.get('children', [])
                if child.get('type') in ['table', 'textblock', 'violation']
            ]
            target_copy['children'] = filtered_children

            parts.append(
                ActFormatter.format_tree_item(
                    target_copy, ctx.tree, tables, textblocks, violations,
                    level=0, max_depth=1, parent_item_number=""
                )
            )
        else:
            parts.append(
                ActFormatter.format_tree_item(
                    target, ctx.tree, tables, textblocks, violations,
                    level=0, max_depth=max_depth, parent_item_number=""
                )
            )

        return assemble_parts(parts)


async def get_items_by_number_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить несколько пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов для извлечения.
        with_metadata: Включать ли метаданные акта.
        recursive: Включать ли подпункты и вложенный контент.

    Returns:
        Словарь {номер_пункта: содержимое}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_item_by_number,
        with_metadata=with_metadata, recursive=recursive,
    )
