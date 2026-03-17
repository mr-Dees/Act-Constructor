"""
Shared служебные эндпоинты для мониторинга и управления.

Доменные config-эндпоинты (lock, invoice) живут в app/domains/*/api/config.py.
"""

import logging
import platform
import sys
from datetime import datetime

from fastapi import APIRouter, Depends

from app.core.config import get_settings, Settings

logger = logging.getLogger("act_constructor.api.system")
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
    Расширенный health check с информацией о системе.

    Полезен для диагностики проблем и мониторинга состояния.
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


@router.get("/version")
async def get_version(settings: Settings = Depends(get_settings)) -> dict:
    """Возвращает информацию о версии сервиса."""
    return {
        "service": settings.app_title,
        "version": settings.app_version,
        "api_version": "v1"
    }
