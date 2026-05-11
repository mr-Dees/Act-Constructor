"""Handler'ы action-инструментов домена acts."""

from __future__ import annotations

import json
from urllib.parse import quote


async def open_act_page_handler(*, km_number: str) -> str:
    """Возвращает ClientActionBlock с командой open_url для перехода к акту."""
    url = f"/acts/{quote(km_number)}"
    block = {
        "type": "client_action",
        "action": "open_url",
        "params": {"url": url},
        "label": f"Открываю акт {km_number}…",
    }
    return json.dumps(block, ensure_ascii=False)
