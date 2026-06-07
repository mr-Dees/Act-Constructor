"""Доменные исключения центра уведомлений."""

from typing import ClassVar

from app.core.exceptions import AppError


class NotificationNotFoundError(AppError):
    """Уведомление не найдено."""
    status_code = 404
    code: ClassVar[str] = "notification-not-found"
