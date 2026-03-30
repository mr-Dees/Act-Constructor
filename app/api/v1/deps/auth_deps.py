"""
Зависимости для авторизации (FastAPI Depends).

Используется как в API-эндпоинтах, так и в HTML-роутах для проверки
авторизации пользователя через переменную окружения JUPYTERHUB_USER.
"""

import logging

from fastapi import HTTPException

from app.api.v1.endpoints.auth import get_current_user_from_env

logger = logging.getLogger("audit_workstation.api.deps.auth")


def get_username() -> str:
    """
    Извлекает имя пользователя из переменной окружения JUPYTERHUB_USER.

    Returns:
        Username в виде цифр

    Raises:
        HTTPException: 401 если пользователь не авторизован
    """
    username = get_current_user_from_env()

    if not username:
        raise HTTPException(
            status_code=401,
            detail="Требуется авторизация"
        )

    return username
