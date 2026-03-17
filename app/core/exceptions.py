"""Базовые исключения приложения."""


class AppError(Exception):
    """Базовый класс всех доменных исключений. Несёт HTTP-статус и detail."""
    status_code: int = 500

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)

    def to_detail(self) -> dict:
        return {"detail": self.message}
