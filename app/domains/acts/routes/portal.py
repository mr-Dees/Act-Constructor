"""HTML-роут страницы управления актами."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_grouped
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/acts", response_class=HTMLResponse)
async def show_acts_manager(request: Request):
    """
    Страница управления актами.

    Отображает список актов пользователя для выбора.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "portal/acts-manager/acts_manager.html",
        {
            "request": request,
            "active_page": "acts",
            "topbar_title": "Управление актами",
            "nav_groups": get_nav_items_grouped(),
            "chat_domains": get_chat_domains_for_page("acts"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
