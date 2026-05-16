"""Трансляция кнопок ответа агента: action_id (имя ChatTool) → client action.

Внешний агент отдаёт кнопки в семантическом виде, например:
    {"action_id": "acts.open_act_page", "label": "Открыть КМ-23-001",
     "params": {"km_number": "КМ-23-001"}}

Этот сервис ресолвит action_id через реестр ChatTool, зовёт зарегистрированный
``button_translator`` и переписывает кнопку в клиентский формат:
    {"action_id": "open_url", "label": "...", "params": {"url": "/constructor?..."}}

Используется в трёх местах:
  * orchestrator (live SSE-стрим forward'а),
  * agent_bridge_runner (сохранение финального ответа агента в БД),
  * api/messages.py resume-эндпоинт.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("audit_workstation.domains.chat.button_translator")


async def translate_buttons(buttons: list[dict]) -> list[dict]:
    """Транслирует серверные action_id в клиентские действия.

    Кнопки без зарегистрированного ChatTool или без ``button_translator``
    пропускаются как есть — фронт получит warn и не сможет обработать клик,
    но это лучше, чем убирать кнопку молча.
    """
    from app.core.chat.tools import get_tool

    result: list[dict] = []
    for btn in buttons:
        if not isinstance(btn, dict):
            result.append(btn)
            continue
        action_id = btn.get("action_id")
        tool = get_tool(action_id) if action_id else None
        if tool is None:
            result.append(btn)
            continue
        translator = getattr(tool, "button_translator", None)
        if translator is None:
            logger.warning(
                "Кнопка с action_id='%s' указывает на ChatTool, но "
                "button_translator не зарегистрирован — кнопка не будет "
                "обработана клиентом",
                action_id,
            )
            result.append(btn)
            continue
        try:
            translated = await translator(btn.get("params") or {})
        except Exception as exc:
            logger.exception(
                "button_translator '%s' завершился ошибкой: %s",
                action_id, exc,
            )
            translated = None
        if translated:
            result.append({
                "action_id": translated["action"],
                "label": btn.get("label", ""),
                "params": translated.get("params", {}),
            })
        else:
            result.append(btn)
    return result
