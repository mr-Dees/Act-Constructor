"""ChatTool-инструменты домена acts.

После перехода на внешнего ИИ-агента информационные tool'ы (search_acts,
get_act_by_km и др. — всего 27) удалены: внешний агент сам ходит в БД.
Здесь остаются только action-tools — команды интерфейса.
"""
from app.core.chat.tools import ChatTool, ChatToolParam
from app.domains.acts.integrations.action_handlers import open_act_page_handler

_DOMAIN = "acts"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена acts."""
    return [
        ChatTool(
            name="acts.open_act_page",
            domain=_DOMAIN,
            description=(
                "Открыть страницу конкретного акта в интерфейсе AuditWorkstation. "
                "Использовать ТОЛЬКО когда пользователь явно просит открыть/перейти "
                "к акту (а не запрашивает данные о нём — для этого есть "
                "chat.forward_to_knowledge_agent)."
            ),
            parameters=[
                ChatToolParam(
                    "km_number", "string",
                    "Номер КМ акта, например КМ-23-00001",
                ),
            ],
            handler=open_act_page_handler,
            category="action",
        ),
    ]
