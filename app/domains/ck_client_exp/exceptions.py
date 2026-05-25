"""Доменные исключения ЦК Клиентский опыт."""

from typing import ClassVar

from app.core.exceptions import AppError


class CSRecordNotFoundError(AppError):
    """Запись CS-валидации не найдена."""

    status_code = 404
    code: ClassVar[str] = "ck-client-exp-record-not-found"


class CSValidationError(AppError):
    """Ошибка валидации данных CS-записи."""

    status_code = 400
    code: ClassVar[str] = "ck-client-exp-validation"
