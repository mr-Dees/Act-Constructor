"""
Точка входа FastAPI приложения.

Этот модуль создает и конфигурирует основное приложение FastAPI,
подключает маршруты API, статические файлы и шаблоны Jinja2,
Проверяет доступ к акту на уровне HTML-роута /constructor.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.responses import FileResponse
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.endpoints.auth import get_current_user_from_env
from app.api.v1.routes import api_router as api_v1_router
from app.core.config import Settings, setup_logging
from app.core.middleware import (
    HTTPSRedirectMiddleware,
    RateLimitMiddleware,
    RequestSizeLimitMiddleware
)
from app.db.connection import (
    init_db,
    close_db,
    create_tables_if_not_exist,
    get_db,
    KerberosTokenExpiredError
)
from app.db.repositories.act_repository import ActDBService

# Инициализируем настройки и логирование один раз на уровне модуля
settings = Settings()
logger = setup_logging(settings.log_level)

root_path = ''
if settings.db_type == 'greenplum':
    root_path = f"/user/{get_current_user_from_env(truncate=False)}/proxy/{settings.port}"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Управление жизненным циклом приложения.
    """
    # Startup
    logger.info("Запуск приложения Act Constructor")
    settings.ensure_directories()

    # ИНИЦИАЛИЗАЦИЯ БД
    try:
        await init_db(settings)
        logger.info("База данных инициализирована")

        # СОЗДАНИЕ ТАБЛИЦ ЕСЛИ НЕ СУЩЕСТВУЮТ
        await create_tables_if_not_exist()
        logger.info("Схема базы данных проверена")

        logger.info("Приложение успешно инициализировано")

    except KerberosTokenExpiredError as e:
        logger.critical(
            "\n" + "=" * 80 + "\n"
                              "КРИТИЧЕСКАЯ ОШИБКА: Не удалось запустить приложение\n"
                              "=" * 80 + "\n"
                                         "Причина: Kerberos токен авторизации протух\n\n"
                                         "Решение:\n"
                                         "1. Откройте терминал JupyterHub\n"
                                         "2. Выполните команду: kinit\n"
                                         "3. Введите ваш пароль\n"
                                         "4. Перезапустите приложение\n"
                                         "=" * 80
        )
        raise RuntimeError(
            "Приложение не может запуститься без валидного Kerberos токена. "
            "Выполните 'kinit' в терминале."
        ) from e
    except Exception as e:
        logger.critical(f"Критическая ошибка при запуске приложения: {e}")
        raise

    yield

    # Shutdown
    logger.info("Завершение работы приложения Act Constructor")

    # Закрываем пул БД
    await close_db()
    logger.info("Database pool закрыт")

    # Закрываем ThreadPoolExecutor
    from app.services.export_service import executor
    executor.shutdown(wait=True, cancel_futures=False)
    logger.info("ThreadPoolExecutor корректно закрыт")


def create_app() -> FastAPI:
    """
    Создает и конфигурирует экземпляр FastAPI приложения.

    Выполняет следующие действия:
    - Создает приложение с метаданными из настроек
    - Инициализирует Jinja2 для рендеринга шаблонов
    - Монтирует статические файлы (CSS, JS, изображения)
    - Регистрирует HTML-роуты с проверкой доступа к актам
    - Подключает API роутеры с префиксом версии
    - Добавляет middleware для контроля нагрузки

    Returns:
        Полностью сконфигурированное приложение
    """
    # Инициализация Jinja2 для рендеринга HTML-шаблонов
    templates = Jinja2Templates(directory=str(settings.templates_dir))

    # Создание FastAPI приложения с базовыми настройками
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="API для создания и управления актами",
        lifespan=lifespan,
        root_path=root_path
    )

    # Добавляем middleware в правильном порядке (первый = последний в цепочке)
    # 1. HTTPS redirect (самый первый - работает с исходным запросом)
    app.add_middleware(HTTPSRedirectMiddleware)

    # 2. Request size limit
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_size=settings.max_request_size
    )

    # 3. Rate limiting (последний)
    app.add_middleware(
        RateLimitMiddleware,
        rate_limit=settings.rate_limit_per_minute,
        settings=settings
    )

    # Подключение статических файлов (доступны по URL /static/*)
    app.mount(
        "/static",
        StaticFiles(directory=str(settings.static_dir)),
        name="static"
    )

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        favicon_path = settings.static_dir / "favicon.ico"
        return FileResponse(favicon_path)

    @app.get("/", response_class=HTMLResponse)
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

    @app.get("/acts", response_class=HTMLResponse)
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

    @app.get("/ck-fin-res", response_class=HTMLResponse)
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

    @app.get("/ck-client-experience", response_class=HTMLResponse)
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

    @app.get("/constructor", response_class=HTMLResponse)
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

    # Обработчик ошибки Kerberos токена
    @app.exception_handler(KerberosTokenExpiredError)
    async def kerberos_token_expired_handler(
            request: Request,
            exc: KerberosTokenExpiredError
    ):
        """
        Обработчик для протухшего Kerberos токена.

        Возвращает понятное сообщение пользователю с инструкциями.
        """
        logger.warning(
            f"Kerberos токен протух во время запроса: {request.url.path}"
        )

        return JSONResponse(
            status_code=401,
            content={
                "error": "kerberos_token_expired",
                "detail": "Токен авторизации Kerberos истек",
                "message": (
                    "Ваш токен авторизации Kerberos истек и требует обновления. "
                    "Для продолжения работы выполните команду 'kinit' в терминале "
                    "JupyterHub и введите ваш пароль. После этого обновите страницу."
                ),
                "instructions": [
                    "Откройте терминал JupyterHub",
                    "Выполните команду: kinit",
                    "Введите ваш пароль",
                    "Обновите страницу приложения"
                ],
                "action_required": "kinit"
            }
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
        reload=True,
        # Уменьшаем verbosity uvicorn логов
        log_level="debug",
        # Если работаем с greenplum через прокси, то указываем корень
        root_path=root_path
    )
