"""
Главный роутер для API версии 1.

Объединяет все эндпоинты API v1 под единым роутером.
"""

from fastapi import APIRouter

from app.api.v1.endpoints import act_operations

# Создание главного роутера для API v1
api_router = APIRouter()

# Список роутеров для подключения
ROUTERS = [
    # Экземпляр роутера, префикс, тег для документации
    (act_operations.router, "/act_operations", ["Операции сохранения актов"]),
]

# Подключение роутеров операций с актами (будут доступны по адресу /api/v1/*/*)
for router, prefix, tags in ROUTERS:
    api_router.include_router(router, prefix=prefix, tags=tags)
