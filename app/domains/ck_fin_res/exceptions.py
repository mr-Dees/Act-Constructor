"""Доменные исключения ЦК Фин.Рез."""

from app.core.exceptions import AppError


class FRRecordNotFoundError(AppError):
    """Запись FR-валидации не найдена."""

    status_code = 404


class FRValidationError(AppError):
    """Ошибка валидации данных FR-записи."""

    status_code = 400
