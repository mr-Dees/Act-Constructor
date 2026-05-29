"""Доменные исключения администрирования."""

from typing import ClassVar

from app.core.exceptions import AppError


class UserNotFoundError(AppError):
    """Пользователь не найден в справочнике."""
    status_code = 404
    code: ClassVar[str] = "admin-user-not-found"


class RoleNotFoundError(AppError):
    """Роль не найдена."""
    status_code = 404
    code: ClassVar[str] = "admin-role-not-found"


class AdminAccessDeniedError(AppError):
    """Пользователь не является администратором."""
    status_code = 403
    code: ClassVar[str] = "admin-access-denied"


class LastAdminError(AppError):
    """Нельзя снять роль — последний администратор системы."""
    status_code = 409
    code: ClassVar[str] = "admin-last-admin"
