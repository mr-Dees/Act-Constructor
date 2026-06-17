"""HTML-роут страницы SQL-агента: iframe на отдельный процесс SQLAgent."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.v1.deps.role_deps import get_user_roles
from app.api.v1.endpoints.auth import get_current_user_from_env
from app.core.config import get_settings
from app.core.navigation import get_knowledge_bases_as_dicts, get_nav_items_for_user
from app.core.settings_registry import get as get_domain_settings
from app.core.templating import get_templates
from app.domains.sqlagent.settings import SQLAgentSettings

templates = get_templates()

router = APIRouter()


def _build_sqlagent_src(sidecar_port: int) -> str:
    """URL встраиваемого UI SQLAgent — абсолютный путь от origin-корня.

    Под Greenplum/JupyterHub-proxy SQLAgent доступен соседним проксированным
    портом того же origin (`/user/{user}/proxy/{port}/`) — зеркало логики
    root_path в app/main.py. На локальном dev (PostgreSQL) — отдельный
    localhost-порт (cross-origin, но iframe всё равно грузится).
    """
    app_settings = get_settings()
    if app_settings.database.type == "greenplum":
        user = get_current_user_from_env(truncate=False)
        return f"/user/{user}/proxy/{sidecar_port}/"
    return f"http://localhost:{sidecar_port}/"


@router.get("/sqlagent", response_class=HTMLResponse)
async def show_sqlagent(request: Request, roles: list[dict] = Depends(get_user_roles)):
    """Страница SQL-агента: встроенный через iframe родной UI SQLAgent."""
    sa_settings = get_domain_settings("sqlagent", SQLAgentSettings)
    return templates.TemplateResponse(
        request,
        "portal/sqlagent/embed.html",
        {
            "active_page": "sqlagent",
            "topbar_title": "SQL-агент",
            "nav_groups": get_nav_items_for_user(roles),
            "is_admin": any(r["name"] == "Админ" for r in roles),
            "chat_domains": None,
            "knowledge_bases": get_knowledge_bases_as_dicts(),
            "sqlagent_src": _build_sqlagent_src(sa_settings.sidecar_port),
        },
    )
