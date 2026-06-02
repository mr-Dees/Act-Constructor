"""Фабрика статического descriptor'а инструмента ``chat.forward_to_knowledge_agent``.

Регистрирует СХЕМУ forward-тула, которую LLM видит в режиме ``adaptive``.
Реальный перехват вызова делает ``agent_loop`` по имени тула — он пишет
запрос в bus-канал ``chat_agent_messages_bus`` и дозаполняет ответ через poller.
Сам этот модуль отвечает только за объявление tool'а (handler=None,
``per_request_handler=True``).
"""
from __future__ import annotations

from app.core.chat.names import TOOL_FORWARD_TO_KNOWLEDGE_AGENT
from app.core.chat.tools import ChatTool, ChatToolParam

_DOMAIN = "chat"

_DESCRIPTION = (
    "Передать вопрос пользователя внешнему ИИ-агенту коллег для "
    "ответа на основе баз знаний (акты, регламенты, нормативы и т.п.). "
    "Использовать для любых вопросов о ДАННЫХ/КОНТЕНТЕ; не использовать "
    "для команд интерфейса (открой/создай/настрой)."
)

_PARAMETERS = (
    ChatToolParam(
        "question", "string",
        "Полный текст вопроса пользователя",
    ),
    ChatToolParam(
        "kb_hint", "string",
        "Опц. подсказка какой БЗ касается вопрос",
        required=False,
    ),
)


def build_forward_tool_descriptor() -> ChatTool:
    """Статический ChatTool для ``forward_to_knowledge_agent``.

    Регистрируется при discover_domains() со ``handler=None`` и
    ``per_request_handler=True``: реальный перехват forward'а делает
    ``agent_loop`` по имени тула (bus-канал ``chat_agent_messages_bus``).
    """
    return ChatTool(
        name=TOOL_FORWARD_TO_KNOWLEDGE_AGENT,
        domain=_DOMAIN,
        description=_DESCRIPTION,
        parameters=list(_PARAMETERS),
        handler=None,
        per_request_handler=True,
        category="forward",
    )


