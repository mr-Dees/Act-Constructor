"""Доменные исключения ЦК Фин.Рез."""

from typing import ClassVar

from app.core.exceptions import AppError


class FRRecordNotFoundError(AppError):
    """Запись FR-валидации не найдена."""

    status_code = 404
    code: ClassVar[str] = "ck-fin-res-record-not-found"


class FRValidationError(AppError):
    """Ошибка валидации данных FR-записи."""

    status_code = 400
    code: ClassVar[str] = "ck-fin-res-validation"


class FRGroupConflictError(AppError):
    """Группа изменена параллельно: набор актуальных строк не совпал с ожидаемым."""

    status_code = 409
    code: ClassVar[str] = "ck-fin-res-group-conflict"
