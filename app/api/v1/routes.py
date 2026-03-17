"""
Главный роутер для API версии 1.

Содержит только shared эндпоинты (auth, chat, system).
Доменные эндпоинты регистрируются через domain_registry.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import auth, chat, system

# Создание главного роутера для API v1
api_router = APIRouter()

# Shared роутеры (доменные регистрируются через auto-discovery)
ROUTERS = [
    (auth, "/auth", ["Авторизация"]),
    (system, "/system", ["Системные операции"]),
    (chat, "/chat", ["AI-ассистент"]),
]

# Подключение shared роутеров
for router, prefix, tags in ROUTERS:
    api_router.include_router(router, prefix=prefix, tags=tags)
