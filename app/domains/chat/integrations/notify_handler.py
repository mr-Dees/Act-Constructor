"""Handler инструмента chat.notify — показать пользователю уведомление.

Возвращает JSON-сериализованный ClientActionBlock; оркестратор парсит
ответ и кладёт блок в массив assistant-блоков. На фронте блок исполняется
через ClientActionsRegistry.execute('notify', ...).
"""
from __future__ import annotations

import json


async def notify_handler(*, message: str, level: str = "info") -> str:
    """Возвращает client_action-блок для всплывающего уведомления."""
    block = {
        "type": "client_action",
        "action": "notify",
        "params": {"message": message, "level": level},
        "label": message,
    }
    return json.dumps(block, ensure_ascii=False)
