"""
Точка входа FastAPI приложения.

Этот модуль создает и конфигурирует основное приложение FastAPI,
подключает маршруты API и HTML-роуты, статические файлы,
настраивает middleware и обработчики ошибок.
Домены обнаруживаются автоматически из app/domains/.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.endpoints.auth import get_current_user_from_env
from app.api.v1.routes import api_router as api_v1_router
from app.core.config import get_settings, setup_logging
from app.core.domain_registry import discover_domains, register_domains
from app.core.middleware import (
    HTTPSRedirectMiddleware,
    RateLimitMiddleware,
    RequestIdMiddleware,
    RequestSizeLimitMiddleware
)
from asyncpg import CheckViolationError, UniqueViolationError

from app.core.exceptions import AppError, CHECK_CONSTRAINT_MESSAGES
from app.db.connection import (
    init_db,
    close_db,
    create_tables_if_not_exist,
    KerberosTokenExpiredError
)
from app.routes.errors import router as error_router
from app.routes.portal import router as portal_router

# Инициализируем настройки и логирование один раз на уровне модуля
settings = get_settings()
logger = setup_logging(settings.server.log_level)

root_path = ''
if settings.database.type == 'greenplum':
    root_path = f"/user/{get_current_user_from_env(truncate=False)}/proxy/{settings.server.port}"

# Директория доменов
_domains_dir = Path(__file__).resolve().parent / "domains"


def _is_html_request(request: Request) -> bool:
    """Проверяет, является ли запрос HTML (не API).

    Используется scope["path"] вместо request.url.path, т.к. url.path
    включает root_path (например, /user/.../proxy/8005/api/v1/...),
    а scope["path"] содержит путь относительно приложения (/api/v1/...).
    """
    path = request.scope.get("path", request.url.path)
    return not path.startswith("/api/")


def _render_error_page(request: Request, code: int, reason: str | None = None):
    """Рендерит HTML-страницу ошибки."""
    from app.core.templating import get_templates
    _templates = get_templates()
    template_map = {
        400: "shared/errors/400.html",
        401: "shared/errors/401.html",
        403: "shared/errors/403.html",
        404: "shared/errors/404.html",
        500: "shared/errors/500.html",
        503: "shared/errors/503.html",
    }
    template_name = template_map.get(code, template_map[500])
    return _templates.TemplateResponse(
        request,
        template_name,
        {"reason": reason},
        status_code=code,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Управление жизненным циклом приложения.
    """
    # Startup
    logger.info("Запуск приложения Audit Workstation")
    settings.ensure_directories()

    # discover_domains() вызывается повторно (первый раз — в create_app для роутеров).
    # Результат кэшируется в _domains, здесь нужен для lifecycle и БД.
    domains = discover_domains(_domains_dir)
    logger.info(f"Обнаружено доменов: {len(domains)}")

    # Список успешно стартовавших доменов — используется и в startup-откате, и в shutdown
    started: list = []

    # ИНИЦИАЛИЗАЦИЯ БД
    try:
        await init_db(settings)
        logger.info("База данных инициализирована")

        # СОЗДАНИЕ ТАБЛИЦ ЕСЛИ НЕ СУЩЕСТВУЮТ
        await create_tables_if_not_exist(domains)
        logger.info("Схема базы данных проверена")

        # Запуск доменов с откатом при частичной ошибке:
        # если on_startup домена N падает, вызываем on_shutdown для 1..N-1
        try:
            for d in domains:
                if d.on_startup:
                    await d.on_startup(app)
                started.append(d)
        except Exception:
            logger.exception(
                "Ошибка при запуске домена, откат инициализированных доменов"
            )
            for d in reversed(started):
                if d.on_shutdown:
                    try:
                        await d.on_shutdown(app)
                    except Exception:
                        logger.exception(f"Ошибка при откате домена {d.name}")
            raise

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
    logger.info("Завершение работы приложения Audit Workstation")

    # Завершение доменов в обратном порядке (только успешно стартовавшие)
    for d in reversed(started):
        if d.on_shutdown:
            try:
                await d.on_shutdown(app)
            except Exception:
                logger.exception(f"Ошибка при завершении домена {d.name}")

    # Закрываем пул БД
    await close_db()
    logger.info("Database pool закрыт")


def create_app() -> FastAPI:
    """
    Создает и конфигурирует экземпляр FastAPI приложения.

    Returns:
        Полностью сконфигурированное приложение
    """
    # Создание FastAPI приложения с базовыми настройками
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="Рабочая станция аудитора — акты, AI-ассистент, аналитика, интеграции",
        lifespan=lifespan,
        root_path=root_path
    )

    # Добавляем middleware в правильном порядке (первый = последний в цепочке)
    # 1. HTTPS redirect (самый первый - работает с исходным запросом)
    app.add_middleware(HTTPSRedirectMiddleware)

    # 2. Request size limit
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_size=settings.security.max_request_size
    )

    # 3. Rate limiting
    app.add_middleware(
        RateLimitMiddleware,
        rate_limit=settings.security.rate_limit_per_minute,
        settings=settings
    )

    # 4. Request ID — самый последний, запускается первым: охватывает всю цепочку middleware
    app.add_middleware(RequestIdMiddleware)

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

    # Обработчик ошибки Kerberos токена
    @app.exception_handler(KerberosTokenExpiredError)
    async def kerberos_token_expired_handler(
            request: Request,
            exc: KerberosTokenExpiredError
    ):
        """Обработчик для протухшего Kerberos токена."""
        logger.warning(
            f"Kerberos токен протух во время запроса: {request.url.path}"
        )

        if _is_html_request(request):
            return _render_error_page(request, 401, reason="kerberos")

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

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        """Единый обработчик всех доменных исключений."""
        if _is_html_request(request):
            return _render_error_page(request, exc.status_code)
        return JSONResponse(status_code=exc.status_code, content=exc.to_detail())

    @app.exception_handler(UniqueViolationError)
    async def unique_violation_handler(request: Request, exc: UniqueViolationError) -> JSONResponse:
        """Fallback для неизвестных конфликтов уникальности из БД."""
        logger.warning(f"UniqueViolationError: {exc} (path: {request.url.path})")
        return JSONResponse(
            status_code=409,
            content={"detail": "Запись с такими данными уже существует"},
        )

    @app.exception_handler(CheckViolationError)
    async def check_violation_handler(request: Request, exc: CheckViolationError) -> JSONResponse:
        """Обработчик нарушений CHECK-ограничений БД."""
        exc_str = str(exc)
        logger.warning(f"CheckViolationError: {exc_str} (path: {request.url.path})")

        detail = "Данные не прошли проверку ограничений базы данных"
        for constraint_name, message in CHECK_CONSTRAINT_MESSAGES.items():
            if constraint_name in exc_str:
                detail = message
                break

        return JSONResponse(status_code=422, content={"detail": detail})

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        """HTTP-ошибки: HTML-страница для браузера, JSON для API."""
        if _is_html_request(request):
            return _render_error_page(request, exc.status_code)
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        """Перехват необработанных исключений — detail ТОЛЬКО в логах."""
        logger.exception(f"Необработанное исключение: {request.url.path}")
        if _is_html_request(request):
            return _render_error_page(request, 500)
        return JSONResponse(
            status_code=500,
            content={"detail": "Внутренняя ошибка сервера"},
        )

    # Подключение роута ошибок (до portal_router)
    app.include_router(error_router)

    # Подключение shared HTML-роутов (лендинг, CK-заглушки)
    app.include_router(portal_router)

    # Подключение shared API роутеров (auth, chat, system)
    app.include_router(
        api_v1_router,
        prefix=settings.server.api_v1_prefix
    )

    # discover_domains() вызывается здесь для регистрации роутеров при создании app.
    # Повторный вызов в lifespan() (для БД и lifecycle) использует кэш _domains.
    domains = discover_domains(_domains_dir)
    register_domains(app, domains, settings.server.api_v1_prefix)

    return app


# Создание экземпляра приложения — только если модуль импортируется (не запускается напрямую).
# При запуске через `python -m app.main` uvicorn сам импортирует модуль в дочернем процессе,
# поэтому здесь не нужно создавать приложение — это исключает лишний цикл инициализации.
if __name__ != "__main__":
    app = create_app()

if __name__ == "__main__":
    # Запуск сервера разработки
    import uvicorn

    uvicorn.run(
        # Настройки сервера
        "app.main:app",
        host=settings.server.host,
        port=settings.server.port,
        # Автоматическая перезагрузка при изменении кода
        reload=True,
        # Уровень uvicorn синхронизирован с SERVER__LOG_LEVEL
        log_level=settings.server.log_level.lower(),
        # Если работаем с greenplum через прокси, то указываем корень
        root_path=root_path
    )
