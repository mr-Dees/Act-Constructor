"""Точка входа FastAPI приложения."""

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.core.config import settings
from app.api.v1.routes import api_router as api_v1_router

# Инициализируем templates здесь для главной страницы
templates = Jinja2Templates(directory=str(settings.templates_dir))


def create_app() -> FastAPI:
    """
    Создает и конфигурирует FastAPI приложение.

    Returns:
        Сконфигурированное приложение FastAPI
    """
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="API для создания и управления актами"
    )

    # Подключаем статические файлы
    app.mount(
        "/static",
        StaticFiles(directory=str(settings.static_dir)),
        name="static"
    )

    # Главная страница на корневом пути
    @app.get("/", response_class=HTMLResponse)
    async def show_constructor(request: Request):
        """
        Отображает страницу конструктора актов.

        Args:
            request: HTTP запрос

        Returns:
            HTML страница конструктора
        """
        return templates.TemplateResponse("constructor.html", {"request": request})

    # Подключаем API v1 с префиксом
    app.include_router(
        api_v1_router,
        prefix=settings.api_v1_prefix
    )

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
