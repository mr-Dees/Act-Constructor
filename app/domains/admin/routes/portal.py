"""HTML-роут страницы администрирования."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.v1.deps.role_deps import get_user_roles
from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_for_user
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/admin", response_class=HTMLResponse)
async def show_admin_page(request: Request, roles: list[dict] = Depends(get_user_roles)):
    """
    Страница администрирования.

    Отображает управление ролями пользователей.
    Авторизация и проверка роли Админ выполняется фронтендом.
    """
    return templates.TemplateResponse(
        "portal/admin/admin.html",
        {
            "request": request,
            "active_page": "admin",
            "topbar_title": "Администрирование",
            "nav_groups": get_nav_items_for_user(roles),
            "is_admin": True,
            "chat_domains": get_chat_domains_for_page("admin"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
