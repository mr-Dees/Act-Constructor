"""Handler'ы action-инструментов домена ck_fin_res."""

from __future__ import annotations

import json

from app.core.chat.names import ACTION_OPEN_URL

_CK_FIN_RES_URL = "/ck-fin-res"


async def open_ck_fin_res_page_handler() -> str:
    """Возвращает client_action-блок, открывающий страницу ЦК Фин.Рез."""
    block = {
        "type": "client_action",
        "action": ACTION_OPEN_URL,
        "params": {"url": _CK_FIN_RES_URL},
        "label": "ЦК Фин.Рез.",
    }
    return json.dumps(block, ensure_ascii=False)


async def open_ck_fin_res_page_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки ck_fin_res.open_ck_fin_res_page → open_url."""
    return {"action": ACTION_OPEN_URL, "params": {"url": _CK_FIN_RES_URL}}
