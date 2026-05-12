"""ChatTool-инструменты домена admin."""
from app.core.chat.tools import ChatTool
from app.domains.admin.integrations.action_handlers import open_admin_panel_handler

_DOMAIN = "admin"


def get_chat_tools() -> list[ChatTool]:
    """Возвращает action-инструменты домена admin."""
    return [
        ChatTool(
            name="admin.open_admin_panel",
            domain=_DOMAIN,
            description=(
                "Открыть админ-панель — страницу управления пользователями "
                "и ролями. Использовать когда пользователь явно просит открыть "
                "/перейти к админ-панели."
            ),
            parameters=[],
            handler=open_admin_panel_handler,
            category="action",
        ),
    ]
