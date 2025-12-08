"""
Главный роутер для API версии 1.

Объединяет все эндпоинты API v1 под единым роутером.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import auth, acts, acts_content, acts_export, system

# Создание главного роутера для API v1
api_router = APIRouter()

# Список роутеров для подключения.
# Формат: (Экземпляр роутера, префикс, теги для документации)
ROUTERS = [
    # Авторизация (первым — логически важнее)
    (auth, "/auth", ["Авторизация"]),
    # Служебные эндпоинты (system endpoints)
    (system, "/system", ["Системные операции"]),
    # Бизнес-логика
    (acts, "/acts", ["Менеджмент актов"]),
    (acts_content, "/acts_content", ["Содержимое актов"]),
    (acts_export, "/acts_export", ["Операции экспорта"]),
]

# Подключение всех роутеров (будут доступны по адресу /api/v1/*/*)
for router, prefix, tags in ROUTERS:
    api_router.include_router(router, prefix=prefix, tags=tags)
