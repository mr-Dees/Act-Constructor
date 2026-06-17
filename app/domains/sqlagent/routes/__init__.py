"""Роутеры домена SQL-агента."""

from app.domains.sqlagent.routes.portal import router as portal_router


def get_html_routers():
    """Возвращает список HTML роутеров домена."""
    return [portal_router]
