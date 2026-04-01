"""Доменные исключения ЦК Клиентский опыт."""

from app.core.exceptions import AppError


class CSRecordNotFoundError(AppError):
    """Запись CS-валидации не найдена."""

    status_code = 404


class CSValidationError(AppError):
    """Ошибка валидации данных CS-записи."""

    status_code = 400
