"""Доменные исключения администрирования."""

from app.core.exceptions import AppError


class UserNotFoundError(AppError):
    """Пользователь не найден в справочнике."""
    status_code = 404


class RoleNotFoundError(AppError):
    """Роль не найдена."""
    status_code = 404


class AdminAccessDeniedError(AppError):
    """Пользователь не является администратором."""
    status_code = 403


class LastAdminError(AppError):
    """Нельзя снять роль — последний администратор системы."""
    status_code = 409
