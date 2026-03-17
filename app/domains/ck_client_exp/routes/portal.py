"""HTML-роут страницы ЦК Клиентский опыт."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_grouped
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/ck-client-experience", response_class=HTMLResponse)
async def show_ck_client_experience(request: Request):
    """
    Страница ЦК Клиентский опыт.

    Раздел в разработке — отображает заглушку.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "portal/ck/ck_client_experience.html",
        {
            "request": request,
            "active_page": "ck_client_experience",
            "topbar_title": "ЦК Клиентский опыт",
            "nav_groups": get_nav_items_grouped(),
            "chat_domains": get_chat_domains_for_page("ck_client_experience"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
