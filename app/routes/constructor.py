"""
HTML-роут конструктора актов.

Содержит маршрут для страницы конструктора с проверкой доступа
пользователя к акту через зависимости авторизации и БД.
"""

from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.api.v1.deps.auth_deps import get_username
from app.core.config import Settings, setup_logging
from app.db.connection import get_db
from app.db.repositories.act_repository import ActDBService

settings = Settings()
logger = setup_logging(settings.log_level)
templates = Jinja2Templates(directory=str(settings.templates_dir))

router = APIRouter()


@router.get("/constructor", response_class=HTMLResponse)
async def show_constructor(
        request: Request,
        act_id: int,
        username: str = Depends(get_username)
):
    """
    Страница конструктора конкретного акта.

    Проверяет доступ пользователя к акту ДО рендеринга HTML.
    При отсутствии доступа редиректит на главную страницу (менеджер актов).

    Args:
        request: HTTP запрос
        act_id: ID акта из query параметра
        username: Имя пользователя (из зависимости get_username)

    Returns:
        HTML страница конструктора или редирект на /

    Raises:
        RedirectResponse: 302 редирект на / при отсутствии доступа
    """
    async with get_db() as conn:
        db_service = ActDBService(conn)

        has_access = await db_service.check_user_access(act_id, username)
        if not has_access:
            logger.info(
                f"Пользователь {username} попытался открыть недоступный акт ID={act_id}, "
                f"редирект на менеджер актов"
            )
            return RedirectResponse(url="/acts", status_code=302)

        return templates.TemplateResponse(
            "constructor.html",
            {"request": request, "act_id": act_id}
        )
