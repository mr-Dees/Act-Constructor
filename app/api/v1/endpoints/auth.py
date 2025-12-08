"""
API эндпоинты для авторизации.
"""

import logging
import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings

logger = logging.getLogger("act_constructor.api.auth")
router = APIRouter()


class AuthResponse(BaseModel):
    """Ответ с информацией об авторизации."""
    authenticated: bool
    username: str | None = None
    display_name: str | None = None


def extract_username_digits(raw_username: str) -> str:
    """
    Извлекает только цифры из username.

    Примеры:
        '22494524_omega-sbrf-ru' -> '22494524'
        '12345678' -> '12345678'

    Args:
        raw_username: Исходный username

    Returns:
        Только цифры из username
    """
    # Берем часть до первого подчеркивания или всю строку
    base_part = raw_username.split('_')[0]

    # Извлекаем только цифры
    digits = re.sub(r'\D', '', base_part)

    return digits


def get_current_user_from_env() -> str | None:
    """
    Получает текущего пользователя из переменных окружения.

    Приоритет:
    1. JUPYTERHUB_USER (устанавливается JupyterHub)
    2. Значение из .env (для разработки)

    Returns:
        Username (только цифры) или None
    """
    settings = get_settings()

    # Сначала проверяем реальную переменную окружения (JupyterHub)
    raw_username = os.environ.get('JUPYTERHUB_USER')

    # Если нет — берем из настроек (.env)
    if not raw_username:
        raw_username = settings.jupyterhub_user

    if not raw_username or raw_username == 'unknown_user':
        return None

    # Извлекаем только цифры
    username = extract_username_digits(raw_username)

    if not username:
        logger.warning(f"Не удалось извлечь цифры из username: {raw_username}")
        return None

    return username


@router.get("/me", response_model=AuthResponse)
async def get_current_user():
    """
    Возвращает информацию о текущем авторизованном пользователе.

    Используется фронтендом для проверки авторизации при загрузке страницы.
    """
    username = get_current_user_from_env()

    if not username:
        logger.warning("Попытка доступа без авторизации")
        return AuthResponse(
            authenticated=False,
            username=None,
            display_name=None
        )

    logger.info(f"Авторизован пользователь: {username}")

    return AuthResponse(
        authenticated=True,
        username=username,
        display_name=f"Пользователь {username}"
    )


@router.get("/validate")
async def validate_session():
    """
    Проверяет валидность текущей сессии.

    Возвращает 401 если пользователь не авторизован.
    Используется для защищенных маршрутов.
    """
    username = get_current_user_from_env()

    if not username:
        raise HTTPException(
            status_code=401,
            detail="Требуется авторизация"
        )

    return {"valid": True, "username": username}
