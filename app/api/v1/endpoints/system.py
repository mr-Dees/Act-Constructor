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

logger = logging.getLogger("act_constructor.api.system")
router = APIRouter()


@router.get("/config/lock")
async def get_lock_config():
    """
    Получает настройки блокировок для фронтенда.

    Returns:
        Настройки блокировок актов
    """
    settings = get_settings()

    return {
        "lockDurationMinutes": settings.lock.duration_minutes,
        "inactivityTimeoutMinutes": settings.lock.inactivity_timeout_minutes,
        "inactivityCheckIntervalSeconds": settings.lock.inactivity_check_interval_seconds,
        "minExtensionIntervalMinutes": settings.lock.min_extension_interval_minutes,
        "inactivityDialogTimeoutSeconds": settings.lock.inactivity_dialog_timeout_seconds
    }


@router.get("/config/invoice")
async def get_invoice_config():
    """
    Получает настройки схем для фактур (для фронтенда).

    Returns:
        Названия схем Hive и GreenPlum
    """
    settings = get_settings()

    return {
        "hiveSchema": settings.invoice.hive_schema,
        "gpSchema": settings.invoice.gp_schema,
    }


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
            "host": settings.server.host,
            "port": settings.server.port,
        },
        "configuration": {
            "max_request_size_mb": settings.security.max_request_size / (1024 * 1024),
            "rate_limit_per_minute": settings.security.rate_limit_per_minute,
            "max_image_size_mb": settings.formatting.max_image_size_mb,
            "html_parse_timeout": settings.formatting.html_parse_timeout,
        }
    }


@router.get("/version")
async def get_version(settings: Settings = Depends(get_settings)) -> dict:
    """Возвращает информацию о версии сервиса."""
    return {
        "service": settings.app_title,
        "version": settings.app_version,
        "api_version": "v1"
    }
