"""HTML роутеры домена актов."""

from app.domains.acts.routes.portal import router as portal_router
from app.domains.acts.routes.constructor import router as constructor_router


def get_html_routers():
    """Возвращает список HTML роутеров домена актов."""
    return [portal_router, constructor_router]
