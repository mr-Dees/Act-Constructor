"""ChatTool-инструменты домена ck_client_exp."""
from app.core.chat.tools import ChatTool
from app.domains.ck_client_exp.integrations.action_handlers import (
    open_ck_client_exp_page_handler,
)

_DOMAIN = "ck_client_exp"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена ck_client_exp."""
    return [
        ChatTool(
            name="ck_client_exp.open_ck_client_exp_page",
            domain=_DOMAIN,
            description=(
                "Открыть страницу ЦК Клиентского Опыта — верификация метрик "
                "клиентского опыта. Использовать когда пользователь явно "
                "просит открыть/перейти к ЦК Клиентский опыт."
            ),
            parameters=[],
            handler=open_ck_client_exp_page_handler,
            category="action",
        ),
    ]
