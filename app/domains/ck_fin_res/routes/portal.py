"""HTML-роут страницы ЦК Фин.Рез."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.v1.deps.role_deps import get_user_roles
from app.core.navigation import get_chat_domains_for_page, get_knowledge_bases_as_dicts, get_nav_items_for_user
from app.core.templating import get_templates

templates = get_templates()

router = APIRouter()


@router.get("/ck-fin-res", response_class=HTMLResponse)
async def show_ck_fin_res(request: Request, roles: list[dict] = Depends(get_user_roles)):
    """Страница ЦК Фин.Рез."""
    return templates.TemplateResponse(
        "portal/ck/ck_fin_res.html",
        {
            "request": request,
            "active_page": "ck_fin_res",
            "topbar_title": "ЦК Фин.Рез.",
            "nav_groups": get_nav_items_for_user(roles),
            "is_admin": any(r["name"] == "Админ" for r in roles),
            "chat_domains": get_chat_domains_for_page("ck_fin_res"),
            "knowledge_bases": get_knowledge_bases_as_dicts(),
        }
    )
