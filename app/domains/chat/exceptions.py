"""Доменные исключения чата."""

from app.core.exceptions import AppError


class ConversationNotFoundError(AppError):
    """Беседа не найдена."""
    status_code = 404


class ChatFileNotFoundError(AppError):
    """Файл чата не найден."""
    status_code = 404


class ActionNotFoundError(AppError):
    """Действие не найдено."""
    status_code = 404


class ChatLimitError(AppError):
    """Превышен лимит (бесед, сообщений и т.д.)."""
    status_code = 422


class ChatFileValidationError(AppError):
    """Файл не проходит валидацию (размер, тип)."""
    status_code = 422
