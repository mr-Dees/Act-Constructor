"""
Точка входа FastAPI приложения.

Этот модуль создает и конфигурирует основное приложение FastAPI,
подключает маршруты API, статические файлы и шаблоны Jinja2.
"""

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.v1.routes import api_router as api_v1_router
from app.core.config import settings

# Инициализация Jinja2 для рендеринга HTML-шаблонов
templates = Jinja2Templates(directory=str(settings.templates_dir))


def create_app() -> FastAPI:
    """
    Создает и конфигурирует экземпляр FastAPI приложения.

    Выполняет следующие действия:
    - Создает приложение с метаданными из настроек
    - Монтирует статические файлы (CSS, JS, изображения)
    - Регистрирует маршрут главной страницы
    - Подключает API роутеры с префиксом версии

    Returns:
        FastAPI: Полностью сконфигурированное приложение
    """
    # Создание FastAPI приложения с базовыми настройками
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="API для создания и управления актами"
    )

    # Подключение статических файлов (Доступны по URL /static/*)
    app.mount(
        "/static",
        StaticFiles(directory=str(settings.static_dir)),
        name="static"
    )

    @app.get("/", response_class=HTMLResponse)
    async def show_constructor(request: Request):
        """
        Отображает главную страницу конструктора актов.

        Args:
            request: Объект HTTP-запроса от FastAPI

        Returns:
            HTMLResponse: Отрендеренный HTML-шаблон конструктора
        """
        return templates.TemplateResponse(
            "constructor.html",
            {"request": request}
        )

    # Подключение API роутеров версии 1 с префиксом /api/v1
    app.include_router(
        api_v1_router,
        prefix=settings.api_v1_prefix
    )

    return app


# Создание глобального экземпляра приложения
app = create_app()

if __name__ == "__main__":
    # Запуск сервера разработки
    import uvicorn

    uvicorn.run(
        # Настройки сервера
        "app.main:app",
        host=settings.host,
        port=settings.port,
        # Автоматическая перезагрузка при изменении кода
        reload=True
    )
