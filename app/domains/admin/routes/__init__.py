"""HTML роутеры домена администрирования."""

from app.domains.admin.routes.portal import router as portal_router


def get_html_routers():
    """Возвращает список HTML роутеров домена администрирования."""
    return [portal_router]
