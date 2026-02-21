"""
Middleware для FastAPI приложения.

Содержит middleware классы для:
- Форсирования HTTPS схемы за прокси (HTTPSRedirectMiddleware)
- Ограничения частоты запросов (RateLimitMiddleware)
- Ограничения размера тела запроса (RequestSizeLimitMiddleware)
"""

import threading
from datetime import datetime, timedelta

from cachetools import TTLCache
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import Settings, setup_logging

settings = Settings()
logger = setup_logging(settings.log_level)


class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """
    Middleware для форсирования HTTPS схемы в запросах.

    Необходим для корректной работы url_for() за прокси JupyterHub,
    который проксирует HTTPS, но отправляет запросы по HTTP.
    """

    async def dispatch(self, request: Request, call_next):
        """
        Перезаписывает схему на HTTPS если запрос пришел через прокси.

        Args:
            request: HTTP запрос
            call_next: Следующий middleware в цепочке

        Returns:
            HTTP ответ
        """
        # Проверяем заголовки прокси
        forwarded_proto = request.headers.get("x-forwarded-proto")
        forwarded_scheme = request.headers.get("x-scheme")

        # Если есть признаки HTTPS прокси - форсируем HTTPS
        if forwarded_proto == "https" or forwarded_scheme == "https":
            # Создаем новый scope с HTTPS схемой
            scope = request.scope
            scope["scheme"] = "https"

            # Пересоздаем Request с новым scope
            request = Request(scope, request.receive)

        response = await call_next(request)
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware для ограничения частоты запросов (rate limiting).

    Используется TTLCache вместо defaultdict для автоматической очистки
    старых записей. Thread-safe и без memory leak.
    """

    def __init__(self, app, rate_limit: int, settings: Settings):
        """
        Инициализация middleware.

        Args:
            app: FastAPI приложение
            rate_limit: Максимум запросов в минуту на IP
            settings: Настройки приложения
        """
        super().__init__(app)
        self.rate_limit = rate_limit

        # TTLCache автоматически удаляет старые записи.
        self.requests = TTLCache(
            maxsize=settings.max_tracked_ips,
            ttl=settings.rate_limit_ttl
        )

        # Блокировка для thread-safety TTLCache (не thread-safe по
        # умолчанию).
        self.lock = threading.Lock()

        logger.info(
            f"Rate limiting инициализирован: {rate_limit} запросов/минуту, "
            f"max_ips={settings.max_tracked_ips}, ttl={settings.rate_limit_ttl}s"
        )

    async def dispatch(self, request: Request, call_next):
        """
        Обрабатывает каждый запрос с проверкой лимита.

        Args:
            request: HTTP запрос
            call_next: Следующий middleware в цепочке

        Returns:
            HTTP ответ или 429 при превышении лимита
        """
        client_ip = request.client.host
        now = datetime.now()

        with self.lock:
            # Получаем или создаем список запросов для IP
            if client_ip not in self.requests:
                self.requests[client_ip] = []

            ip_requests = self.requests[client_ip]

            # Фильтруем запросы за последнюю минуту
            cutoff_time = now - timedelta(minutes=1)
            recent_requests = [ts for ts in ip_requests if ts > cutoff_time]

            # Проверка лимита
            if len(recent_requests) >= self.rate_limit:
                logger.warning(f"Rate limit превышен для IP: {client_ip}")
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Слишком много запросов. Попробуйте позже.",
                        "retry_after": 60
                    }
                )

            # Добавляем текущий запрос
            recent_requests.append(now)
            self.requests[client_ip] = recent_requests

        response = await call_next(request)
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Middleware для ограничения размера тела запроса.

    Предотвращает исчерпание памяти при отправке огромных JSON.
    """

    def __init__(self, app, max_size: int):
        """
        Инициализация middleware.

        Args:
            app: FastAPI приложение
            max_size: Максимальный размер тела запроса в байтах
        """
        super().__init__(app)
        self.max_size = max_size
        logger.info(f"Request size limit установлен: {max_size / (1024 * 1024):.1f}MB")

    async def dispatch(self, request: Request, call_next):
        """
        Проверяет размер тела запроса.

        Args:
            request: HTTP запрос
            call_next: Следующий middleware в цепочке

        Returns:
            HTTP ответ или 413 при превышении лимита
        """
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
