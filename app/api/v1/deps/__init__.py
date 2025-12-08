"""
Пакет зависимостей FastAPI (Depends) для API v1.

Содержит переиспользуемые зависимости:
- Авторизация и извлечение username
- Проверка доступа к ресурсам (по мере добавления)
"""

from app.api.v1.deps.auth_deps import get_username

__all__ = [
    "get_username",
]
