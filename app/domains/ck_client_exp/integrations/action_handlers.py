"""Handler'ы action-инструментов домена ck_client_exp."""

from __future__ import annotations

import json

from app.core.chat.names import ACTION_OPEN_URL

_CK_CLIENT_EXP_URL = "/ck-client-experience"


async def open_ck_client_exp_page_handler() -> str:
    """Возвращает client_action-блок, открывающий страницу ЦК Клиентский опыт."""
    block = {
        "type": "client_action",
        "action": ACTION_OPEN_URL,
        "params": {"url": _CK_CLIENT_EXP_URL},
        "label": "ЦК Клиентский опыт",
    }
    return json.dumps(block, ensure_ascii=False)


async def open_ck_client_exp_page_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки ck_client_exp.open_ck_client_exp_page → open_url."""
    return {"action": ACTION_OPEN_URL, "params": {"url": _CK_CLIENT_EXP_URL}}
