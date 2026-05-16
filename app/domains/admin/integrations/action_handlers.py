"""Handler'ы action-инструментов домена admin."""

from __future__ import annotations

import json
import uuid

from app.core.chat.names import ACTION_OPEN_URL

_ADMIN_URL = "/admin"


async def open_admin_panel_handler() -> str:
    """Возвращает client_action-блок, открывающий админ-панель."""
    block = {
        "type": "client_action",
        "action": ACTION_OPEN_URL,
        "params": {"url": _ADMIN_URL},
        "label": "Администрирование",
        "block_id": str(uuid.uuid4()),
    }
    return json.dumps(block, ensure_ascii=False)


async def open_admin_panel_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки admin.open_admin_panel → open_url."""
    return {"action": ACTION_OPEN_URL, "params": {"url": _ADMIN_URL}}
