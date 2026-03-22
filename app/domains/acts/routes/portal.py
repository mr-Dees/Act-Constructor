"""HTML-роут страницы управления актами."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.v1.deps.role_deps import get_user_roles
from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_for_user
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/acts", response_class=HTMLResponse)
async def show_acts_manager(request: Request, roles: list[dict] = Depends(get_user_roles)):
    """Страница управления актами."""
    return templates.TemplateResponse(
        "portal/acts-manager/acts_manager.html",
        {
            "request": request,
            "active_page": "acts",
            "topbar_title": "Управление актами",
            "nav_groups": get_nav_items_for_user(roles),
            "is_admin": any(r["name"] == "Админ" for r in roles),
            "chat_domains": get_chat_domains_for_page("acts"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
