"""Регистрация ChatTool-инструментов домена chat.

Содержит:
  - chat.forward_to_knowledge_agent — переадресация запроса внешнему ИИ-агенту
  - chat.notify                     — показать уведомление пользователю

Handler для forward — фабричный (зависит от контекста сообщения), поэтому
здесь регистрируется без handler'а через :func:`build_forward_tool_descriptor`;
оркестратор на каждом запросе сам подставляет замыкание через
``forward_tool_factory.build_forward_tool``.
"""
from __future__ import annotations

from app.core.chat.names import TOOL_LIST_PAGES, TOOL_NOTIFY
from app.core.chat.tools import ChatTool, ChatToolParam
from app.domains.chat.integrations.list_pages_handler import list_pages_handler
from app.domains.chat.integrations.notify_handler import notify_handler
from app.domains.chat.services.forward_tool_factory import (
    build_forward_tool_descriptor,
)

_DOMAIN = "chat"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает инструменты домена chat для регистрации в реестре."""
    return [
        build_forward_tool_descriptor(),
        ChatTool(
            name=TOOL_NOTIFY,
            domain=_DOMAIN,
            description=(
                "Показать пользователю всплывающее уведомление в "
                "интерфейсе. Уровни: 'info', 'success', 'warning', 'error'."
            ),
            parameters=[
                ChatToolParam("message", "string", "Текст уведомления"),
                ChatToolParam(
                    "level", "string", "Уровень уведомления",
                    required=False, default="info",
                    enum=["info", "success", "warning", "error"],
                ),
            ],
            handler=notify_handler,
            category="action",
        ),
        ChatTool(
            name=TOOL_LIST_PAGES,
            domain=_DOMAIN,
            description=(
                "Покажи пользователю кнопки со всеми доступными страницами. "
                "Используй когда пользователь спрашивает что ты умеешь, какие "
                "функции доступны, что есть в системе."
            ),
            parameters=[],
            handler=list_pages_handler,
            category="action",
        ),
    ]
