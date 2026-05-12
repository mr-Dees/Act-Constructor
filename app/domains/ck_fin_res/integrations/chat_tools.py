"""ChatTool-инструменты домена ck_fin_res."""
from app.core.chat.tools import ChatTool
from app.domains.ck_fin_res.integrations.action_handlers import (
    open_ck_fin_res_page_handler,
)

_DOMAIN = "ck_fin_res"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена ck_fin_res."""
    return [
        ChatTool(
            name="ck_fin_res.open_ck_fin_res_page",
            domain=_DOMAIN,
            description=(
                "Открыть страницу ЦК Финансовых Результатов — верификация "
                "метрик финансовых результатов. Использовать когда "
                "пользователь явно просит открыть/перейти к ЦК Фин.Рез."
            ),
            parameters=[],
            handler=open_ck_fin_res_page_handler,
            category="action",
        ),
    ]
