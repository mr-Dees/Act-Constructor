"""Handler'ы action-инструментов домена admin."""

from __future__ import annotations

import json


_ADMIN_URL = "/admin"


async def open_admin_panel_handler() -> str:
    """Возвращает client_action-блок, открывающий админ-панель."""
    block = {
        "type": "client_action",
        "action": "open_url",
        "params": {"url": _ADMIN_URL},
        "label": "Администрирование",
    }
    return json.dumps(block, ensure_ascii=False)


async def open_admin_panel_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки admin.open_admin_panel → open_url."""
    return {"action": "open_url", "params": {"url": _ADMIN_URL}}
