"""
Shared служебные эндпоинты для мониторинга и управления.

Доменные config-эндпоинты (lock, invoice) живут в app/domains/*/api/config.py.
"""

import logging
import platform
import sys
import time
from collections import deque
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.api.v1.deps.auth_deps import get_username
from app.core.config import get_settings, Settings
from app.core.domain_registry import get_domain
from app.schemas.errors import ErrorDetail

logger = logging.getLogger("audit_workstation.api.system")
router = APIRouter()


# ---------------------------------------------------------------------------
# Client error reporting (см. POST /client-error)
# ---------------------------------------------------------------------------

# Per-user rate-limit для /client-error: не более N репортов в окно T секунд.
# Глобальный middleware уже ограничивает запросы на уровне IP, но это слишком
# мягко для error-репортов. Цель — защитить логи от storm'а одного юзера со
# сломанным фронтом (вечный setInterval с throw). Хранится в памяти процесса;
# в JupyterHub-деплое процесс на юзера, чего достаточно.
_CLIENT_ERROR_RATE_LIMIT = 10  # репортов в окно
_CLIENT_ERROR_RATE_WINDOW_SEC = 60.0
# username → deque(timestamp,...); deque ограничен длиной limit, старое сходит.
_client_error_timestamps: dict[str, deque[float]] = {}


def _client_error_check_rate_limit(username: str) -> bool:
    """Возвращает True если репорт можно принять, False если лимит исчерпан."""
    now = time.monotonic()
    bucket = _client_error_timestamps.get(username)
    if bucket is None:
        bucket = deque(maxlen=_CLIENT_ERROR_RATE_LIMIT)
        _client_error_timestamps[username] = bucket
    # Чистим протухшие
    cutoff = now - _CLIENT_ERROR_RATE_WINDOW_SEC
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= _CLIENT_ERROR_RATE_LIMIT:
        return False
    bucket.append(now)
    return True


class ClientErrorPayload(BaseModel):
    """Тело отчёта об ошибке фронтенда от window.onerror/unhandledrejection."""

    type: str = Field(..., description="Тип события: 'error' | 'unhandledrejection'")
    message: str = Field(..., description="Текст ошибки")
    url: Optional[str] = Field(None, description="URL источника (e.filename или location.href)")
    lineno: Optional[int] = Field(None, description="Номер строки")
    colno: Optional[int] = Field(None, description="Номер колонки")
    stack: Optional[str] = Field(None, description="Stack trace, если доступен")
    userAgent: Optional[str] = Field(None, description="navigator.userAgent клиента")
    currentActId: Optional[int] = Field(None, description="ID акта в момент ошибки (если есть)")


@router.post(
    "/client-error",
    status_code=204,
    responses={
        204: {"description": "Отчёт принят"},
        429: {"description": "Слишком много отчётов от пользователя", "model": ErrorDetail},
    },
)
async def client_error(
    payload: ClientErrorPayload,
    request: Request,
    username: str = Depends(get_username),
) -> Response:
    """
    Принимает отчёт об ошибке от глобального error-boundary на фронте.

    Логирует с уровнем WARNING — это не критические серверные ошибки, но
    сигнал для мониторинга качества фронта. Per-user rate-limit (см.
    `_client_error_check_rate_limit`) защищает логи от storm'а сломанной
    страницы. При превышении лимита возвращаем 429.
    """
    if not _client_error_check_rate_limit(username):
        raise HTTPException(
            status_code=429,
            detail="Превышен лимит отчётов об ошибках, попробуйте позже",
        )

    ip = request.client.host if request.client else "?"
    logger.warning(
        f"[client-error] user={username} ip={ip} payload={payload.model_dump()}"
    )
    return Response(status_code=204)


@router.get("/health")
async def health_check(settings: Settings = Depends(get_settings)) -> dict:
    """
    Базовый health check для мониторинга доступности сервиса.

    Используется load balancers и системами мониторинга (Prometheus, Kubernetes).
    """
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version
    }


@router.get("/health/detailed")
async def detailed_health_check(settings: Settings = Depends(get_settings)) -> dict:
    """
    Расширенный health check без авторизации.

    Возвращает только безопасную информацию (без системных деталей).
    """
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version,
        "timestamp": datetime.now().isoformat(),
    }


@router.get("/health/detailed/full", responses={401: {"description": "Требуется авторизация", "model": ErrorDetail}})
async def detailed_health_check_full(
    username: str = Depends(get_username),
    settings: Settings = Depends(get_settings),
) -> dict:
    """
    Полный health check с системной информацией (требует авторизации).

    Доступен только авторизованным пользователям. Включает версию Python,
    платформу, хост и порт для диагностики.
    """
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version,
        "timestamp": datetime.now().isoformat(),
        "environment": {
            "python_version": sys.version,
            "platform": platform.platform(),
            "host": settings.server.host,
            "port": settings.server.port,
        },
    }


@router.get("/health/{domain_name}")
async def domain_health(domain_name: str) -> dict:
    """Health-проверка конкретного домена.

    Каждый домен может зарегистрировать ``health_check()`` в своём
    ``DomainDescriptor``. Если домен не найден или не зарегистрировал
    health_check — 404. Если зарегистрировал и проверка упала — возвращаем
    HTTP 200 со статусом ``error``; мониторинг сам решает по полю ``status``.
    """
    domain = get_domain(domain_name)
    if domain is None or domain.health_check is None:
        raise HTTPException(
            status_code=404,
            detail=f"Health-check для домена '{domain_name}' не зарегистрирован",
        )

    try:
        result = await domain.health_check()
    except Exception as exc:
        logger.exception(f"Health-check домена {domain_name} упал: {exc}")
        return {"status": "error", "domain": domain_name, "error": str(exc)}

    # Гарантируем поля domain/status в ответе
    if not isinstance(result, dict):
        return {"status": "error", "domain": domain_name, "error": "health_check вернул не dict"}
    result.setdefault("domain", domain_name)
    result.setdefault("status", "ok")
    return result


@router.get("/version")
async def get_version(settings: Settings = Depends(get_settings)) -> dict:
    """Возвращает информацию о версии сервиса."""
    return {
        "service": settings.app_title,
        "version": settings.app_version,
        "api_version": "v1"
    }
