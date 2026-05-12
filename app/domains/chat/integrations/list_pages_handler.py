"""Handler инструмента chat.list_pages — описание + кнопки доступных страниц.

Возвращает JSON-сериализованный список из двух блоков:
  1) text-блок с кратким описанием ассистента и списком разделов;
  2) buttons-блок с кнопками для перехода на страницы.

Оркестратор парсит результат и эмитит соответствующие SSE-события.
"""
from __future__ import annotations

import json


_INTRO = (
    "Я ассистент Audit Workstation. Помогаю работать с актами аудита, "
    "открывать разделы системы, отвечать на вопросы из базы знаний."
)

_EXTRA_CAPABILITIES = (
    "Также я могу:\n"
    "- Открыть конкретный акт по КМ-номеру или служебной записке — "
    "скажи \"Открой акт КМ-XX-XXXXX\"\n"
    "- Найти информацию из базы знаний — задай вопрос"
)


async def list_pages_handler() -> str:
    """Возвращает текст-описание и кнопки для всех зарегистрированных страниц."""
    from app.core.domain_registry import get_all_domains

    page_lines: list[str] = []
    buttons: list[dict] = []
    for d in get_all_domains():
        for nav in d.nav_items:
            if not nav.url:
                continue
            buttons.append({
                "action_id": "open_url",
                "label": nav.label,
                "params": {"url": nav.url},
            })
            if nav.description:
                page_lines.append(f"- **{nav.label}** — {nav.description}")

    text_parts = [_INTRO]
    if page_lines:
        text_parts.append("**Доступные разделы:**\n" + "\n".join(page_lines))
    text_parts.append(_EXTRA_CAPABILITIES)
    text = "\n\n".join(text_parts)

    blocks = [
        {"type": "text", "text": text},
        {"type": "buttons", "buttons": buttons},
    ]
    return json.dumps(blocks, ensure_ascii=False)
