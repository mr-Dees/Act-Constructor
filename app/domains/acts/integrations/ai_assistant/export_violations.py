"""Извлечение нарушений актов."""

from typing import Dict, List

from app.formatters.utils import JSONUtils
from app.domains.acts.integrations.ai_assistant._helpers import (
    ActContext, build_node_map, find_parent_number,
    assemble_parts, prepend_metadata,
    batch_over_km, batch_over_items,
)
from app.domains.acts.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter


async def get_all_violations(
        km_number: str,
        with_metadata: bool = False
) -> str:
    """
    Получить все нарушения по КМ-акту.

    Извлекает все нарушения из акта с указанием родительского пункта для
    каждого нарушения.

    Args:
        km_number: КМ номер акта.
        with_metadata: Включать ли метаданные акта в начало вывода.

    Returns:
        Отформатированный список нарушений или сообщение об отсутствии.
    """
    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        violations = await ctx.queries.get_all_violations(ctx.conn, ctx.act['id'], ctx.tree)

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not violations:
            parts.append(f"В акте КМ {km_number} нет нарушений.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for v in violations:
                parent_number = find_parent_number(
                    ctx.tree, v.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_violation(v, parent_number or ""))

        return assemble_parts(parts)


async def get_all_violations_batch(
        km_numbers: List[str],
        with_metadata: bool = False
) -> Dict[str, str]:
    """
    Получить все нарушения по списку КМ батчем.

    Args:
        km_numbers: Список КМ номеров актов.
        with_metadata: Включать ли метаданные для каждого акта.

    Returns:
        Словарь {КМ: нарушения}.
    """
    return await batch_over_km(
        km_numbers, get_all_violations, with_metadata=with_metadata
    )


async def get_violation_by_item(
        km_number: str,
        item_number: str | List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить нарушения по конкретному пункту (или нескольким пунктам) КМ.

    Извлекает нарушения, находящиеся в указанном пункте и опционально в его
    подпунктах.

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Если item_number - str: отформатированные нарушения в пункте.
        Если item_number - List[str]: Dict[номер_пункта: нарушения].
    """
    if isinstance(item_number, list):
        return await get_violations_by_item_list(
            km_number, item_number, with_metadata, recursive
        )

    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        violations = await ctx.queries.get_violations_by_item(
            ctx.conn, ctx.act['id'], item_number, ctx.tree, recursive
        )

        parts = []
        prepend_metadata(parts, ctx.act, with_metadata)

        if not violations:
            scope = "и подпунктах" if recursive else ""
            parts.append(f"В пункте {item_number} {scope} КМ {km_number} нет нарушений.")
        else:
            node_id_to_number = build_node_map(ctx.tree)

            for v in violations:
                parent_number = find_parent_number(
                    ctx.tree, v.get('node_id'), node_id_to_number
                )
                parts.append(ActFormatter.format_violation(v, parent_number or ""))

        return assemble_parts(parts)


async def get_violations_by_item_list(
        km_number: str,
        item_numbers: List[str],
        with_metadata: bool = False,
        recursive: bool = True
) -> Dict[str, str]:
    """
    Получить нарушения по списку пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов.
        with_metadata: Включать ли метаданные акта.
        recursive: Искать ли в подпунктах.

    Returns:
        Словарь {номер_пункта: нарушения}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_violation_by_item,
        with_metadata=with_metadata, recursive=recursive,
    )


async def get_violation_fields(
        km_number: str,
        item_number: str | List[str],
        field_names: List[str],
        recursive: bool = True
) -> str | Dict[str, str]:
    """
    Получить определённые поля всех нарушений пункта (или нескольких пунктов) КМ.

    Извлекает только указанные поля из нарушений, игнорируя остальное содержимое.

    Доступные поля:
    - Базовые текстовые: "violated", "established"
    - Дополнительный контент (по отдельности): "case", "image", "freeText"
    - Весь доп. контент разом: "additional_content"
    - Опциональные блоки: "responsible", "consequences", "reasons", "recommendations"

    Args:
        km_number: КМ номер акта.
        item_number: Номер пункта ("5.1") или список номеров (["5.1", "5.2"]).
        field_names: Список имен полей для извлечения.
        recursive: Искать ли в подпунктах.

    Returns:
        Если item_number - str: отформатированные поля нарушений.
        Если item_number - List[str]: Dict[номер_пункта: поля нарушений].
    """
    if isinstance(item_number, list):
        return await get_violation_fields_batch(
            km_number, item_number, field_names, recursive
        )

    async with ActContext(km_number) as ctx:
        if ctx.error:
            return ctx.error

        violations = await ctx.queries.get_violations_by_item(
            ctx.conn, ctx.act['id'], item_number, ctx.tree, recursive
        )

        if not violations:
            scope = "и подпунктах" if recursive else ""
            return f"В пункте {item_number} {scope} нет нарушений."

        node_id_to_number = build_node_map(ctx.tree)

        # Валидация полей
        valid_fields = {
            "violated", "established",
            "case", "image", "freeText", "additional_content",
            "responsible", "consequences", "reasons", "recommendations"
        }
        invalid_fields = [f for f in field_names if f not in valid_fields]
        if invalid_fields:
            return (
                f"Неизвестные поля: {', '.join(invalid_fields)}. "
                f"Доступные: {', '.join(sorted(valid_fields))}"
            )

        parts = []
        for idx, v in enumerate(violations, 1):
            parent_number = find_parent_number(
                ctx.tree, v.get('node_id'), node_id_to_number
            )
            parent_info = f"пункт {parent_number}" if parent_number else "N/A"

            violation_parts = []
            violation_header = f"Нарушение {idx} ({parent_info})"

            for field_name in field_names:
                if field_name == "violated":
                    violated = v.get('violated', '').strip()
                    if violated:
                        violation_parts.append(f"  Нарушено: {violated}")

                elif field_name == "established":
                    established = v.get('established', '').strip()
                    if established:
                        violation_parts.append(f"  Установлено: {established}")

                elif field_name == "additional_content":
                    add_content = JSONUtils.parse_db_json_field(v.get("additional_content"))
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

                elif field_name in ("case", "image", "freeText"):
                    add_content = JSONUtils.parse_db_json_field(v.get("additional_content"))
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

                elif field_name in ["responsible", "consequences", "reasons", "recommendations"]:
                    value = JSONUtils.parse_db_json_field(v.get(field_name))
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

            if violation_parts:
                parts.append(violation_header)
                parts.extend(violation_parts)
                parts.append("")

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
    Получить конкретные поля нарушений по списку пунктов батчем.

    Args:
        km_number: КМ номер акта.
        item_numbers: Список номеров пунктов.
        field_names: Список имен полей для извлечения.
        recursive: Искать ли в подпунктах.

    Returns:
        Словарь {номер_пункта: поля нарушений}.
    """
    return await batch_over_items(
        km_number, item_numbers, get_violation_fields,
        field_names=field_names, recursive=recursive,
    )
