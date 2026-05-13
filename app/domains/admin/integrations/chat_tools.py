"""ChatTool-инструменты домена admin."""
from app.core.chat.names import TOOL_OPEN_ADMIN_PANEL
from app.core.chat.tools import ChatTool
from app.domains.admin.integrations.action_handlers import (
    open_admin_panel_button_translator,
    open_admin_panel_handler,
)

_DOMAIN = "admin"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена admin."""
    return [
        ChatTool(
            name=TOOL_OPEN_ADMIN_PANEL,
            domain=_DOMAIN,
            description=(
                "Открыть админ-панель — страницу управления пользователями "
                "и ролями. Использовать когда пользователь явно просит открыть "
                "/перейти к админ-панели."
            ),
            parameters=[],
            handler=open_admin_panel_handler,
            category="action",
            button_translator=open_admin_panel_button_translator,
        ),
    ]
