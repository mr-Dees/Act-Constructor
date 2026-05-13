"""ChatTool-инструменты домена ck_client_exp."""
from app.core.chat.names import TOOL_OPEN_CK_CLIENT_EXP_PAGE
from app.core.chat.tools import ChatTool
from app.domains.ck_client_exp.integrations.action_handlers import (
    open_ck_client_exp_page_button_translator,
    open_ck_client_exp_page_handler,
)

_DOMAIN = "ck_client_exp"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена ck_client_exp."""
    return [
        ChatTool(
            name=TOOL_OPEN_CK_CLIENT_EXP_PAGE,
            domain=_DOMAIN,
            description=(
                "Открыть страницу ЦК Клиентского Опыта — верификация метрик "
                "клиентского опыта. Использовать когда пользователь явно "
                "просит открыть/перейти к ЦК Клиентский опыт."
            ),
            parameters=[],
            handler=open_ck_client_exp_page_handler,
            category="action",
            button_translator=open_ck_client_exp_page_button_translator,
        ),
    ]
