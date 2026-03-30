"""Роутеры домена ЦК Клиентский опыт."""

from app.domains.ck_client_exp.routes.portal import router as portal_router


def get_html_routers():
    """Возвращает список HTML роутеров домена."""
    return [portal_router]
