"""Главный роутер для API v1."""

from fastapi import APIRouter

from app.api.v1.endpoints import acts

# Создаем роутер только для API эндпоинтов
api_router = APIRouter()

# Подключаем эндпоинты работы с актами
api_router.include_router(
    acts.router,
    tags=["acts"]
)
