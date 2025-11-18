"""
Точка входа FastAPI приложения.

Этот модуль создает и конфигурирует основное приложение FastAPI,
подключает маршруты API, статические файлы и шаблоны Jinja2.
"""

import threading
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.routes import api_router as api_v1_router
from app.core.config import Settings, setup_logging

# Инициализируем настройки и логирование один раз на уровне модуля
settings = Settings()
logger = setup_logging(settings.log_level)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware для ограничения частоты запросов (rate limiting).

    Отслеживает количество запросов с каждого IP за последнюю минуту.
    ИСПРАВЛЕНО: добавлена thread-safety и эффективная очистка.
    """

    def __init__(self, app, rate_limit: int, settings: Settings):
        super().__init__(app)
        self.rate_limit = rate_limit
        # Словарь: IP -> список timestamp'ов запросов
        self.requests = defaultdict(list)
        # Блокировка для thread-safety
        self.lock = threading.Lock()

        # Параметры из настроек вместо хардкода
        self.max_ips = settings.max_tracked_ips
        self.cleanup_interval = settings.rate_limit_cleanup_interval
        self.history_minutes = settings.rate_limit_history_minutes

        self.last_cleanup = datetime.now()
        logger.info(
            f"Rate limiting инициализирован: {rate_limit} запросов/минуту, "
            f"max_ips={self.max_ips}, cleanup_interval={self.cleanup_interval}s"
        )

    async def dispatch(self, request: Request, call_next):
        """Обрабатывает каждый запрос с проверкой лимита."""
        client_ip = request.client.host
        now = datetime.now()

        with self.lock:
            # Периодическая глобальная очистка
            if (now - self.last_cleanup).total_seconds() > self.cleanup_interval:
                self._cleanup_old_requests(now)
                self.last_cleanup = now

            # Ограничение количества отслеживаемых IP (защита от memory exhaustion)
            if len(self.requests) >= self.max_ips and client_ip not in self.requests:
                # Удаляем самый старый IP
                oldest_ip = min(self.requests.keys(),
                                key=lambda ip: self.requests[ip][-1] if self.requests[ip] else now)
                del self.requests[oldest_ip]
                logger.debug(f"Удален старый IP из rate limiter: {oldest_ip}")

            # Получаем список запросов для текущего IP
            ip_requests = self.requests[client_ip]

            # Быстрая проверка лимита (используем существующий список)
            cutoff_time = now - timedelta(minutes=1)
            recent_requests = [ts for ts in ip_requests if ts > cutoff_time]

            if len(recent_requests) >= self.rate_limit:
                logger.warning(f"Rate limit превышен для IP: {client_ip}")
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Слишком много запросов. Попробуйте позже.",
                        "retry_after": 60
                    }
                )

            # Обновляем список (удаляем старые и добавляем новый)
            recent_requests.append(now)
            self.requests[client_ip] = recent_requests

        response = await call_next(request)
        return response

    def _cleanup_old_requests(self, now: datetime):
        """
        Эффективная фоновая очистка старых запросов.

        Удаляет все запросы старше настроенного времени и пустые IP-записи.
        """
        # Используем параметр из настроек
        cutoff_time = now - timedelta(minutes=self.history_minutes)
        ips_to_remove = []

        for ip, timestamps in self.requests.items():
            # Фильтруем старые запросы
            recent = [ts for ts in timestamps if ts > cutoff_time]
            if recent:
                self.requests[ip] = recent
            else:
                # Помечаем пустые записи для удаления
                ips_to_remove.append(ip)

        # Удаляем пустые IP
        for ip in ips_to_remove:
            del self.requests[ip]

        if ips_to_remove:
            logger.debug(f"Очищено {len(ips_to_remove)} неактивных IP из rate limiter")


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware для ограничения размера тела запроса.

    Предотвращает исчерпание памяти при отправке огромных JSON.
    """

    def __init__(self, app, max_size: int):
        super().__init__(app)
        self.max_size = max_size
        logger.info(f"Request size limit установлен: {max_size / (1024 * 1024):.1f}MB")

    async def dispatch(self, request: Request, call_next):
        """Проверяет размер тела запроса."""
        content_length = request.headers.get("content-length")

        if content_length:
            content_length = int(content_length)
            if content_length > self.max_size:
                logger.warning(
                    f"Отклонен запрос с размером {content_length / (1024 * 1024):.1f}MB "
                    f"от {request.client.host}"
                )
                return JSONResponse(
                    status_code=413,
                    content={
                        "detail": f"Размер запроса превышает лимит "
                                  f"({self.max_size / (1024 * 1024):.1f}MB)"
                    }
                )

        response = await call_next(request)
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Управление жизненным циклом приложения.

    Выполняется один раз при запуске и остановке worker-процесса.
    """
    # Startup
    logger.info("Запуск приложения Act Constructor")
    settings.ensure_directories()
    logger.info("Приложение успешно инициализировано")

    yield

    # Shutdown
    logger.info("Завершение работы приложения Act Constructor")


def create_app() -> FastAPI:
    """
    Создает и конфигурирует экземпляр FastAPI приложения.

    Выполняет следующие действия:
    - Создает приложение с метаданными из настроек
    - Инициализирует Jinja2 для рендеринга шаблонов
    - Монтирует статические файлы (CSS, JS, изображения)
    - Регистрирует маршрут главной страницы
    - Подключает API роутеры с префиксом версии
    - Добавляет middleware для контроля нагрузки

    Returns:
        FastAPI: Полностью сконфигурированное приложение
    """
    # Инициализация Jinja2 для рендеринга HTML-шаблонов
    templates = Jinja2Templates(directory=str(settings.templates_dir))

    # Создание FastAPI приложения с базовыми настройками
    app = FastAPI(
        title=settings.app_title,
        version=settings.app_version,
        description="API для создания и управления актами",
        lifespan=lifespan
    )

    # Добавляем middleware для ограничений (порядок важен: сначала размер, потом rate limit)
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_size=settings.max_request_size
    )
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
        reload=True,
        # Уменьшаем verbosity uvicorn логов
        log_level="info"
    )
