"""Извлечение текстовых блоков актов."""

from typing import Dict, List

from app.domains.acts.integrations.ai_assistant._helpers import (
    ActContext, build_node_map, find_parent_number,
    assemble_parts, prepend_metadata,
    batch_over_km, batch_over_items,
)
from app.domains.acts.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter
from app.domains.acts.integrations.ai_assistant.queries.act_queries import ActQueries


async def get_all_textblocks(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """
    Получить все текстовые блоки по КМ.

    Извлекает все текстовые блоки из акта с указанием родительского пункта
    для каждого блока.

    Args:
        km_number: КМ номер акта.
        with_metadata: Включать ли метаданные акта в начало вывода.

    Returns:
        Отформатированный список текстовых блоков или сообщение об отсутствии.
    """
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        textblocks = await ActQueries.get_all_textblocks(ctx.conn, ctx.act['id'], ctx.tree)

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not textblocks:
            parts.append(f"В акте КМ {km_number} нет текстовых блоков.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for tb in textblocks:
                parent_number = find_parent_number(
                    ctx.tree, tb.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_textblock(tb, parent_number or ""))

        return assemble_parts(parts)


async def get_all_textblocks_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все текстовые блоки по списку КМ батчем.

    Args:
        km_numbers: Список КМ номеров актов.
        with_metadata: Включать ли метаданные для каждого акта.

    Returns:
        Словарь {КМ: текстовые блоки}.
    """
    return await batch_over_km(
        km_numbers, get_all_textblocks, with_metadata=with_metadata
    )


async def get_textblocks_by_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить текстовые блоки по пункту (или нескольким пунктам) и КМ.

    Извлекает текстовые блоки, находящиеся в указанном пункте и опционально
    в его подпунктах.

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Если item_number - str: отформатированные текстовые блоки.
        Если item_number - List[str]: Dict[номер_пункта: текстовые блоки].
    """
    if isinstance(item_number, list):
        return await get_textblocks_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        textblocks = await ActQueries.get_textblocks_by_item(
            ctx.conn, ctx.act['id'], item_number, ctx.tree, recursive
        )

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not textblocks:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет текстовых блоков.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for tb in textblocks:
                parent_number = find_parent_number(
                    ctx.tree, tb.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_textblock(tb, parent_number or ""))

        return assemble_parts(parts)


async def get_textblocks_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить текстовые блоки по списку пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов.
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Словарь {номер_пункта: текстовые блоки}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_textblocks_by_item,
        with_metadata=with_metadata, recursive=recursive,
    )
