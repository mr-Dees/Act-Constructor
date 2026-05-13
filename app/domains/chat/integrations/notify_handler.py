"""Handler инструмента chat.notify — показать пользователю уведомление.

Возвращает JSON-сериализованный ClientActionBlock; оркестратор парсит
ответ и кладёт блок в массив assistant-блоков. На фронте блок исполняется
через ClientActionsRegistry.execute('notify', ...).
"""
from __future__ import annotations

import json
import uuid

from app.core.chat.names import ACTION_NOTIFY


async def notify_handler(*, message: str, level: str = "info") -> str:
    """Возвращает client_action-блок для всплывающего уведомления."""
    block = {
        "type": "client_action",
        "action": ACTION_NOTIFY,
        "params": {"message": message, "level": level},
        "label": message,
        "block_id": str(uuid.uuid4()),
    }
    return json.dumps(block, ensure_ascii=False)
