"""HTML-роут страниц ошибок."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from app.core.templating import get_templates

templates = get_templates()
router = APIRouter()

_KNOWN_CODES = {400, 401, 403, 404, 500, 503}

_TEMPLATE_MAP = {
    400: "shared/errors/400.html",
    401: "shared/errors/401.html",
    403: "shared/errors/403.html",
    404: "shared/errors/404.html",
    500: "shared/errors/500.html",
    503: "shared/errors/503.html",
}


@router.get("/error/{code}", response_class=HTMLResponse)
async def show_error_page(request: Request, code: int, reason: str | None = None):
    """
    Standalone error page.

    Query params:
        reason — used ONLY as Jinja2 condition (e.g. reason=kerberos), never rendered as text
    """
    if code not in _KNOWN_CODES:
        template_name = _TEMPLATE_MAP[404]
        status = 404
    else:
        template_name = _TEMPLATE_MAP[code]
        status = code

    return templates.TemplateResponse(
        request,
        template_name,
        {"reason": reason},
        status_code=status,
    )
