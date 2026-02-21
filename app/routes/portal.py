"""
HTML-роуты портальных страниц.

Содержит маршруты для:
- Стартовая страница (landing)
- Управление актами (acts manager)
- ЦК Фин.Рез. (заглушка)
- ЦК Клиентский опыт (заглушка)
"""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.core.config import Settings

settings = Settings()
templates = Jinja2Templates(directory=str(settings.templates_dir))

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def show_landing(request: Request):
    """
    Стартовая страница - портал инструментов.

    Отображает дашборд с навигацией по инструментам компании.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "landing.html",
        {
            "request": request,
            "active_page": "landing",
            "topbar_title": "Рабочее пространство",
        }
    )


@router.get("/acts", response_class=HTMLResponse)
async def show_acts_manager(request: Request):
    """
    Страница управления актами.

    Отображает список актов пользователя для выбора.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "acts_manager.html",
        {
            "request": request,
            "active_page": "acts",
            "topbar_title": "Управление актами",
        }
    )


@router.get("/ck-fin-res", response_class=HTMLResponse)
async def show_ck_fin_res(request: Request):
    """
    Страница ЦК Фин.Рез.

    Раздел в разработке — отображает заглушку.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "ck_fin_res.html",
        {
            "request": request,
            "active_page": "ck_fin_res",
            "topbar_title": "ЦК Фин.Рез.",
        }
    )


@router.get("/ck-client-experience", response_class=HTMLResponse)
async def show_ck_client_experience(request: Request):
    """
    Страница ЦК Клиентский опыт.

    Раздел в разработке — отображает заглушку.
    Авторизация проверяется фронтендом через /api/v1/auth/me.
    """
    return templates.TemplateResponse(
        "ck_client_experience.html",
        {
            "request": request,
            "active_page": "ck_client_experience",
            "topbar_title": "ЦК Клиентский опыт",
        }
    )
