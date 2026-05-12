"""Handler инструмента chat.list_pages — кнопки со всеми доступными страницами.

Возвращает JSON-сериализованный ButtonGroup-блок; оркестратор парсит ответ
и эмитит SSE-событие 'buttons', чтобы фронт отрисовал группу кнопок.
"""
from __future__ import annotations

import json


async def list_pages_handler() -> str:
    """Возвращает блок с кнопками для всех зарегистрированных страниц доменов."""
    from app.core.domain_registry import get_all_domains

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

    block = {"type": "buttons", "buttons": buttons}
    return json.dumps(block, ensure_ascii=False)
