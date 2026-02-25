"""Доменные исключения Act Constructor."""


class ActConstructorError(Exception):
    """Базовый класс всех доменных исключений. Несёт HTTP-статус и detail."""
    status_code: int = 500

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)

    def to_detail(self) -> dict:
        return {"detail": self.message}


class ActNotFoundError(ActConstructorError):
    """Акт или связанный ресурс не найден."""
    status_code = 404


class AccessDeniedError(ActConstructorError):
    """Пользователь не имеет доступа к акту."""
    status_code = 403


class InsufficientRightsError(ActConstructorError):
    """Пользователь имеет доступ, но не имеет прав на данную операцию."""
    status_code = 403


class ActLockError(ActConstructorError):
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


class KmConflictError(ActConstructorError):
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


class ActValidationError(ActConstructorError):
    """Ошибка бизнес-валидации данных акта."""
    status_code = 400


class UnsupportedFormatError(ActConstructorError):
    """Запрошен неподдерживаемый формат экспорта."""
    status_code = 400


class InvoiceError(ActConstructorError):
    """Ошибка при работе с фактурой (неподдерживаемый тип БД и т.п.)."""
    status_code = 400
