"""Получение структуры актов в виде дерева пунктов."""

from typing import Dict, List

from app.domains.acts.integrations.ai_assistant._helpers import ActContext, batch_over_km
from app.domains.acts.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter


async def get_act_structure(
        km_number: str,
        with_statistics: bool = False
) -> str:
    """
    Получить структуру акта в виде дерева пунктов.

    Возвращает иерархическое представление структуры акта с опциональной
    статистикой по количеству таблиц, текстовых блоков и нарушений.

    Args:
        km_number: КМ номер акта для получения структуры.
        with_statistics: Включать ли подсчет элементов контента.

    Returns:
        Дерево структуры акта или сообщение об ошибке.
    """
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        if not ctx.tree:
            return "Структура акта не найдена."

        if with_statistics:
            tables = await ctx.queries.get_all_tables(ctx.conn, ctx.act['id'], ctx.tree)
            textblocks = await ctx.queries.get_all_textblocks(ctx.conn, ctx.act['id'], ctx.tree)
            violations = await ctx.queries.get_all_violations(ctx.conn, ctx.act['id'], ctx.tree)

            return ActFormatter.format_tree_structure(
                ctx.tree,
                stats={
                    'tables': len(tables),
                    'textblocks': len(textblocks),
                    'violations': len(violations)
                }
            )

        return ActFormatter.format_tree_structure(ctx.tree)


async def get_act_structures_batch(
        km_numbers: List[str],
        with_statistics: bool = False
) -> Dict[str, str]:
    """
    Получить структуры нескольких актов батчем.

    Args:
        km_numbers: Список КМ номеров актов.
        with_statistics: Включать ли статистику по элементам контента.

    Returns:
        Словарь {КМ: структура акта}.
    """
    return await batch_over_km(
        km_numbers, get_act_structure, with_statistics=with_statistics
    )
