"""Получение полного содержимого актов."""

from typing import Dict, List

from app.integrations.ai_assistant._helpers import (
    ActContext, assemble_parts, prepend_metadata, batch_over_km,
)
from app.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter
from app.integrations.ai_assistant.queries.act_queries import ActQueries


async def get_act_by_km(
        km_number: str,
        with_metadata: bool = True
) -> str:
    """
    Получить весь акт по КМ как человекочитаемый текст.

    Возвращает полное содержимое акта включая метаданные, аудиторскую группу,
    поручения и все элементы контента (таблицы, текстовые блоки, нарушения).

    Args:
        km_number: КМ номер акта для получения.
        with_metadata: Включать ли метаданные в начало вывода.

    Returns:
        Полный текст акта или сообщение об ошибке.
    """
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        tables = await ActQueries.get_all_tables(ctx.conn, ctx.act['id'], ctx.tree)
        textblocks = await ActQueries.get_all_textblocks(ctx.conn, ctx.act['id'], ctx.tree)
        violations = await ActQueries.get_all_violations(ctx.conn, ctx.act['id'], ctx.tree)

        parts = []

        if with_metadata:
            parts.append(ActFormatter.format_metadata(ctx.act))

            team = await ActQueries.get_audit_team(ctx.conn, ctx.act['id'])
            parts.append(ActFormatter.format_audit_team(team))

            directives = await ActQueries.get_directives(ctx.conn, ctx.act['id'])
            if directives:
                parts.append(ActFormatter.format_directives(directives))

        if ctx.tree:
            content = ActFormatter.format_tree_item(
                ctx.tree, ctx.tree, tables, textblocks, violations
            )
            if content.strip():
                parts.append(content)

        return assemble_parts(parts)


async def get_acts_by_km_list(
        km_numbers: List[str],
        with_metadata: bool = True
) -> Dict[str, str]:
    """
    Получить несколько актов по списку КМ батчем.

    Args:
        km_numbers: Список КМ номеров актов.
        with_metadata: Включать ли метаданные для каждого акта.

    Returns:
        Словарь {КМ: текст акта или сообщение об ошибке}.
    """
    return await batch_over_km(
        km_numbers, get_act_by_km, with_metadata=with_metadata
    )
