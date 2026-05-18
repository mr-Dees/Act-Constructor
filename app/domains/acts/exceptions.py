"""Доменные исключения актов."""

from app.core.exceptions import AppError


class ActNotFoundError(AppError):
    """Акт или связанный ресурс не найден."""
    status_code = 404


class AccessDeniedError(AppError):
    """Пользователь не имеет доступа к акту."""
    status_code = 403


class InsufficientRightsError(AppError):
    """Пользователь имеет доступ, но не имеет прав на данную операцию."""
    status_code = 403


class ActLockError(AppError):
    """Акт заблокирован другим пользователем или блокировка нарушена."""
    status_code = 409

    def __init__(
        self,
        message: str,
        locked_by: str | None = None,
        locked_until: str | None = None,
    ) -> None:
        super().__init__(message)
        self.locked_by = locked_by
        self.locked_until = locked_until

    def to_detail(self) -> dict:
        return {
            "detail": self.message,
            "locked_by": self.locked_by,
            "locked_until": self.locked_until,
        }


class KmConflictError(AppError):
    """Акт с таким КМ уже существует (конфликт уникальности)."""
    status_code = 409

    def __init__(
        self,
        message: str,
        km_number: str | None = None,
        current_parts: int | None = None,
        next_part: int | None = None,
    ) -> None:
        super().__init__(message)
        self.km_number = km_number
        self.current_parts = current_parts
        self.next_part = next_part

    def to_detail(self) -> dict:
        return {
            "detail": self.message,
            "type": "km_exists",
            "km_number": self.km_number,
            "current_parts": self.current_parts,
            "next_part": self.next_part,
        }


class ActValidationError(AppError):
    """Ошибка бизнес-валидации данных акта."""
    status_code = 400


class UnsupportedFormatError(AppError):
    """Запрошен неподдерживаемый формат экспорта."""
    status_code = 400


class ActExportValidationError(AppError):
    """Ошибка бизнес-валидации при экспорте акта (например, превышена глубина дерева)."""
    status_code = 400


class ActExportTimeoutError(AppError):
    """Операция экспорта акта превысила допустимое время ожидания."""
    status_code = 408


class ManagementRoleRequiredError(AppError):
    """Операция доступна только для Куратора или Руководителя."""
    status_code = 403


class InvoiceError(AppError):
    """Ошибка при работе с фактурой (неподдерживаемый тип БД и т.п.)."""
    status_code = 400
