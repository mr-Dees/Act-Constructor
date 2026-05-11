"""Регистрация ChatTool-инструментов домена chat.

Содержит:
  - chat.forward_to_knowledge_agent — переадресация запроса внешнему ИИ-агенту
  - chat.notify                     — показать уведомление пользователю

Handler для forward — фабричный (зависит от контекста сообщения), поэтому
здесь регистрируется без handler'а; оркестратор на каждом запросе сам
подставляет замыкание через build_forward_handler.
"""
from __future__ import annotations

from app.core.chat.tools import ChatTool, ChatToolParam
from app.domains.chat.integrations.notify_handler import notify_handler

_DOMAIN = "chat"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает инструменты домена chat для регистрации в реестре."""
    return [
        ChatTool(
            name="chat.forward_to_knowledge_agent",
            domain=_DOMAIN,
            description=(
                "Передать вопрос пользователя внешнему ИИ-агенту коллег для "
                "ответа на основе баз знаний (акты, регламенты, нормативы и т.п.). "
                "Использовать для любых вопросов о ДАННЫХ/КОНТЕНТЕ; не использовать "
                "для команд интерфейса (открой/создай/настрой)."
            ),
            parameters=[
                ChatToolParam(
                    "question", "string",
                    "Полный текст вопроса пользователя",
                ),
                ChatToolParam(
                    "kb_hint", "string",
                    "Опц. подсказка какой БЗ касается вопрос",
                    required=False,
                ),
            ],
            handler=None,  # подставляется оркестратором per-request
            category="forward",
        ),
        ChatTool(
            name="chat.notify",
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
    ]
