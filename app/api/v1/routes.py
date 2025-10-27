"""
Главный роутер для API версии 1.

Объединяет все эндпоинты API v1 под единым роутером,
который затем подключается в главном приложении.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import act_operations

# Создание главного роутера для API v1
api_router = APIRouter()

# Подключение роутера операций с актами
# Эндпоинты будут доступны по адресу /api/v1/act_operations/*
api_router.include_router(
    act_operations.router,
    # Префикс для указания эндпоинтов без пути
    prefix="/act_operations",
    # Тег для группировки в документации
    tags=["act_operations"]
)
