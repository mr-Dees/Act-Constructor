"""
Главный роутер для API версии 1.

Объединяет все эндпоинты API v1 под единым роутером.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import act_operations, system

# Создание главного роутера для API v1
api_router = APIRouter()

# Список роутеров для подключения.
# Формат: (Экземпляр роутера, префикс, теги для документации)
ROUTERS = [
    # Служебные эндпоинты (system endpoints)
    (system.router, "/system", ["Системные операции"]),
    # Бизнес-логика
    (act_operations.router, "/act_operations", ["Операции с актами"]),
]

# Подключение всех роутеров (будут доступны по адресу /api/v1/*/*)
for router, prefix, tags in ROUTERS:
    api_router.include_router(router, prefix=prefix, tags=tags)
