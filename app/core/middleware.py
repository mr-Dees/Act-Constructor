"""
Middleware для FastAPI приложения.

Все middleware реализованы как raw ASGI — без BaseHTTPMiddleware,
который буферизирует тело ответа и ломает SSE-стриминг.

Содержит middleware классы для:
- Форсирования HTTPS схемы за прокси (HTTPSRedirectMiddleware)
- Ограничения частоты запросов (RateLimitMiddleware)
- Ограничения размера тела запроса (RequestSizeLimitMiddleware)
- Назначения request_id (RequestIdMiddleware)
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timedelta

from cachetools import TTLCache

from app.core.config import Settings, get_settings, request_id_var

settings = get_settings()
logger = logging.getLogger("audit_workstation.middleware")


class HTTPSRedirectMiddleware:
    """
    Middleware для форсирования HTTPS схемы в запросах.

    Необходим для корректной работы url_for() за прокси JupyterHub,
    который проксирует HTTPS, но отправляет запросы по HTTP.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            if (
                headers.get(b"x-forwarded-proto") == b"https"
                or headers.get(b"x-scheme") == b"https"
            ):
                scope["scheme"] = "https"

        await self.app(scope, receive, send)


class RateLimitMiddleware:
    """
    Middleware для ограничения частоты запросов (rate limiting).

    Используется TTLCache вместо defaultdict для автоматической очистки
    старых записей. Thread-safe и без memory leak.
    """

    def __init__(self, app, rate_limit: int, settings: Settings):
        self.app = app
        self.rate_limit = rate_limit

        # TTLCache автоматически удаляет старые записи.
        self.requests = TTLCache(
            maxsize=settings.security.max_tracked_ips,
            ttl=settings.security.rate_limit_ttl
        )

        # asyncio.Lock — корректный примитив для async-кода.
        self.lock = asyncio.Lock()

        logger.info(
            f"Rate limiting инициализирован: {rate_limit} запросов/минуту, "
            f"max_ips={settings.security.max_tracked_ips}, ttl={settings.security.rate_limit_ttl}s"
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        client_ip = client[0] if client else "unknown"
        now = datetime.now()
        cutoff_time = now - timedelta(minutes=1)

        async with self.lock:
            if client_ip not in self.requests:
                self.requests[client_ip] = []

            ip_requests = self.requests[client_ip]

            # Скользящее окно: отбрасываем метки старше 60 секунд
            recent_requests = [ts for ts in ip_requests if ts > cutoff_time]

            if len(recent_requests) >= self.rate_limit:
                logger.warning(f"Rate limit превышен для IP: {client_ip}")
                body = json.dumps({
                    "detail": "Слишком много запросов. Попробуйте позже.",
                    "retry_after": 60,
                }).encode("utf-8")
                await send({
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [
                        [b"content-type", b"application/json"],
                        [b"content-length", str(len(body)).encode()],
                    ],
                })
                await send({
                    "type": "http.response.body",
                    "body": body,
                })
                return

            recent_requests.append(now)
            self.requests[client_ip] = recent_requests

        await self.app(scope, receive, send)


# Используется raw ASGI middleware вместо BaseHTTPMiddleware, т.к. BaseHTTPMiddleware
# буферизует тело запроса целиком до вызова dispatch(), что делает невозможным
# потоковый контроль размера при chunked transfer encoding (без Content-Length).
class RequestSizeLimitMiddleware:
    """
    Middleware для ограничения размера тела запроса.

    Предотвращает исчерпание памяти при отправке огромных JSON.
    Raw ASGI middleware для поддержки chunked transfer encoding.
    """

    def __init__(self, app, max_size: int):
        self.app = app
        self.max_size = max_size
        logger.info(f"Request size limit установлен: {max_size / (1024 * 1024):.1f}MB")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast path: проверка Content-Length до чтения тела
        headers = dict(scope.get("headers", []))
        content_length_raw = headers.get(b"content-length")
        if content_length_raw:
            try:
                content_length = int(content_length_raw)
            except (ValueError, TypeError):
                content_length = 0
            if content_length > self.max_size:
                client_host = self._get_client_host(scope)
                logger.warning(
                    f"Отклонен запрос с размером {content_length / (1024 * 1024):.1f}MB "
                    f"от {client_host}"
                )
                await self._send_413(send)
                return

        # Streaming path: оборачиваем receive для контроля размера по чанкам
        received_size = 0
        rejected = False

        async def receive_wrapper():
            nonlocal received_size, rejected
            message = await receive()
            if message["type"] == "http.request" and not rejected:
                received_size += len(message.get("body", b""))
                if received_size > self.max_size:
                    rejected = True
                    client_host = self._get_client_host(scope)
                    logger.warning(
                        f"Отклонен chunked запрос с размером >{received_size / (1024 * 1024):.1f}MB "
                        f"от {client_host}"
                    )
                    await self._send_413(send)
                    return {"type": "http.disconnect"}
            return message

        # Блокируем send после отправки 413, чтобы app не отправил повторный ответ
        async def send_wrapper(message):
            if not rejected:
                await send(message)

        await self.app(scope, receive_wrapper, send_wrapper)

    def _get_client_host(self, scope) -> str:
        client = scope.get("client")
        return client[0] if client else "unknown"

    async def _send_413(self, send):
        body = json.dumps(
            {"detail": f"Размер запроса превышает лимит ({self.max_size / (1024 * 1024):.1f}MB)"}
        ).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 413,
            "headers": [
                [b"content-type", b"application/json"],
                [b"content-length", str(len(body)).encode()],
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })


class RequestIdMiddleware:
    """
    Назначает уникальный request_id каждому входящему запросу.

    Читает X-Request-ID из заголовков (для сквозной трассировки через прокси),
    иначе генерирует короткий UUID. Сохраняет в ContextVar — доступен во всех логах
    в рамках обработки запроса. Возвращает request_id в заголовке ответа.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Извлекаем X-Request-ID из заголовков запроса
        request_id = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                request_id = value.decode()
                break

        if not request_id:
            request_id = uuid.uuid4().hex[:8]

        request_id_var.set(request_id)

        # Добавляем X-Request-ID в заголовки ответа
        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append([b"x-request-id", request_id.encode()])
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)
