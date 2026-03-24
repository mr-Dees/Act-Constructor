"""HTML-роут страницы ЦК Клиентский опыт."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.v1.deps.role_deps import get_user_roles
from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_for_user
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/ck-client-experience", response_class=HTMLResponse)
async def show_ck_client_experience(request: Request, roles: list[dict] = Depends(get_user_roles)):
    """Страница ЦК Клиентский опыт."""
    return templates.TemplateResponse(
        request,
        "portal/ck/ck_client_experience.html",
        {
            "active_page": "ck_client_experience",
            "topbar_title": "ЦК Клиентский опыт",
            "nav_groups": get_nav_items_for_user(roles),
            "is_admin": any(r["name"] == "Админ" for r in roles),
            "chat_domains": get_chat_domains_for_page("ck_client_experience"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
