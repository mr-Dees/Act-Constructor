"""
Служебные эндпоинты для мониторинга и управления.

Содержит health checks, метрики и другие системные операции.
"""

import logging
import platform
import sys
from datetime import datetime

from fastapi import APIRouter, Depends

from app.core.config import get_settings, Settings

logger = logging.getLogger("act_constructor.system")
router = APIRouter()


@router.get("/health")
async def health_check(settings: Settings = Depends(get_settings)) -> dict:
    """
    Базовый health check для мониторинга доступности сервиса.

    Используется load balancers и системами мониторинга (Prometheus, Kubernetes).

    Returns:
        Минимальная информация о статусе сервиса
    """
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version
    }


@router.get("/health/detailed")
async def detailed_health_check(settings: Settings = Depends(get_settings)) -> dict:
    """
    Расширенный health check с информацией о системе.

    Полезен для диагностики проблем и мониторинга состояния.

    Returns:
        Детальная информация о сервисе и окружении
    """
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version,
        "timestamp": datetime.now().isoformat(),
        "environment": {
            "python_version": sys.version,
            "platform": platform.platform(),
            "host": settings.host,
            "port": settings.port,
        },
        "configuration": {
            "max_request_size_mb": settings.max_request_size / (1024 * 1024),
            "rate_limit_per_minute": settings.rate_limit_per_minute,
            "max_image_size_mb": settings.max_image_size_mb,
            "html_parse_timeout": settings.html_parse_timeout,
        }
    }


@router.get("/version")
async def get_version(settings: Settings = Depends(get_settings)) -> dict:
    """
    Информация о версии сервиса.

    Returns:
        Версия приложения и API
    """
    return {
        "service": settings.app_title,
        "version": settings.app_version,
        "api_version": "v1"
    }
