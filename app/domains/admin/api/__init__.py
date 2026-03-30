"""API роутеры домена администрирования."""

from app.domains.admin.api.roles import router as roles_router


def get_api_routers():
    """Возвращает список API роутеров домена администрирования."""
    return [
        (roles_router, "/admin", ["Администрирование"]),
    ]
