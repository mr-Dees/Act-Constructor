"""
Shared служебные эндпоинты для мониторинга и управления.

Доменные config-эндпоинты (lock, invoice) живут в app/domains/*/api/config.py.
"""

import logging
import platform
import sys
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.deps.auth_deps import get_username
from app.core.config import get_settings, Settings
from app.core.domain_registry import get_domain
from app.schemas.errors import ErrorDetail

logger = logging.getLogger("audit_workstation.api.system")
router = APIRouter()


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
