"""Роутеры домена ЦК Фин.Рез."""

from app.domains.ck_fin_res.routes.portal import router as portal_router


def get_html_routers():
    """Возвращает список HTML роутеров домена."""
    return [portal_router]
