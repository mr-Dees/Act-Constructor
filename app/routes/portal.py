"""
HTML-роуты shared портальных страниц.

Содержит маршруты для:
- Стартовая страница (landing)

Доменные HTML-роуты (/acts, /constructor, /ck-*) живут в app/domains/*/routes/.
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.core.navigation import get_knowledge_bases_as_dicts, get_nav_items_grouped
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def show_landing(request: Request):
    """
    Стартовая страница - портал инструментов.

    Отображает дашборд с навигацией по инструментам компании.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "portal/landing/landing.html",
        {
            "request": request,
            "active_page": "landing",
            "topbar_title": "Рабочее пространство",
            "nav_groups": get_nav_items_grouped(),
            "chat_domains": None,
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
