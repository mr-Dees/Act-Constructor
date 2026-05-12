"""Handler'ы action-инструментов домена admin."""

from __future__ import annotations

import json


async def open_admin_panel_handler() -> str:
    """Возвращает client_action-блок, открывающий админ-панель."""
    block = {
        "type": "client_action",
        "action": "open_url",
        "params": {"url": "/admin"},
        "label": "Администрирование",
    }
    return json.dumps(block, ensure_ascii=False)
