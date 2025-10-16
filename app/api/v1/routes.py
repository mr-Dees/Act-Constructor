"""Главный роутер для API v1."""

from fastapi import APIRouter

from app.api.v1.endpoints import act_operations

# Создаем роутер только для API эндпоинтов
api_router = APIRouter()

# Подключаем эндпоинты работы с актами
api_router.include_router(
    act_operations.router,
    prefix="/act_operations",
    tags=["act_operations"]
)
