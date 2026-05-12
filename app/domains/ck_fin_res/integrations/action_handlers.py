"""Handler'ы action-инструментов домена ck_fin_res."""

from __future__ import annotations

import json


async def open_ck_fin_res_page_handler() -> str:
    """Возвращает client_action-блок, открывающий страницу ЦК Фин.Рез."""
    block = {
        "type": "client_action",
        "action": "open_url",
        "params": {"url": "/ck-fin-res"},
        "label": "ЦК Фин.Рез.",
    }
    return json.dumps(block, ensure_ascii=False)
