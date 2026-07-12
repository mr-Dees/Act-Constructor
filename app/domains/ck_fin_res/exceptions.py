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
    """409-конфликт группы ЦКФР: параллельное изменение существующей группы
    (набор актуальных строк не совпал с ожидаемым), попытка создать или
    переименовать группу под уже занятый ключ (пункт+метрика), либо гонка
    при создании дублирующих строк ТБ, разрешаемая post-commit проверкой."""

    status_code = 409
    code: ClassVar[str] = "ck-fin-res-group-conflict"
