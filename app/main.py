"""
Точка входа FastAPI приложения.

Этот модуль создает и конфигурирует основное приложение FastAPI,
подключает маршруты API и HTML-роуты, статические файлы,
настраивает middleware и обработчики ошибок.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

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
    KerberosTokenExpiredError
)
from app.routes.portal import router as portal_router
from app.routes.constructor import router as constructor_router

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
    - Монтирует статические файлы (CSS, JS, изображения)
    - Подключает HTML-роуты (портал, конструктор)
    - Подключает API роутеры с префиксом версии
    - Добавляет middleware для контроля нагрузки

    Returns:
        Полностью сконфигурированное приложение
    """
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

    # Подключение HTML-роутов
    app.include_router(portal_router)
    app.include_router(constructor_router)

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
