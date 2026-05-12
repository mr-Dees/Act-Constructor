"""Handler'ы action-инструментов домена ck_client_exp."""

from __future__ import annotations

import json


async def open_ck_client_exp_page_handler() -> str:
    """Возвращает client_action-блок, открывающий страницу ЦК Клиентский опыт."""
    block = {
        "type": "client_action",
        "action": "open_url",
        "params": {"url": "/ck-client-experience"},
        "label": "ЦК Клиентский опыт",
    }
    return json.dumps(block, ensure_ascii=False)
