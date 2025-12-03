"""
Пакет зависимостей FastAPI (Depends).

Содержит переиспользуемые зависимости для эндпоинтов API:
- Авторизация и извлечение username
- Проверка доступа к ресурсам
- Валидация параметров запросов
"""

from app.api.v1.deps.auth_deps import get_username

__all__ = [
    "get_username",
]
