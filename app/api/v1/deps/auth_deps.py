# app/api/v1/deps/auth_deps.py
"""
Зависимости для авторизации (FastAPI Depends).

Используется как в API-эндпоинтах, так и в HTML-роутах для проверки
авторизации пользователя через заголовок X-JupyterHub-User или переменную окружения.
"""

import logging
from typing import Annotated

from fastapi import Header, Depends, HTTPException

from app.api.v1.endpoints.auth import get_current_user_from_env, extract_username_digits
from app.core.config import get_settings, Settings

logger = logging.getLogger("act_constructor.auth_deps")


def get_username(
        x_jupyterhub_user: Annotated[str | None, Header()] = None,
        settings: Settings = Depends(get_settings)
) -> str:
    """
    Извлекает имя пользователя для текущего запроса.

    Приоритет источников:
    1. Заголовок X-JupyterHub-User (передан фронтендом из localStorage)
    2. Переменная окружения JUPYTERHUB_USER
    3. Значение из .env файла

    Args:
        x_jupyterhub_user: Заголовок от фронтенда (опционально)
        settings: Настройки приложения

    Returns:
        Username в виде цифр (например, "22494524")

    Raises:
        HTTPException: 401 если пользователь не авторизован
    """
    # Если передан заголовок — используем его (уже очищенный)
    if x_jupyterhub_user:
        return extract_username_digits(x_jupyterhub_user)

    # Иначе берем из окружения
    username = get_current_user_from_env()

    if not username:
        raise HTTPException(
            status_code=401,
            detail="Требуется авторизация"
        )

    return username
