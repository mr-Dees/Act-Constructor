"""Pydantic-модели ответов API."""

from pydantic import BaseModel


class OperationResult(BaseModel):
    """Стандартный ответ для операций без специфичных данных."""
    success: bool = True
    message: str


class LockResponse(BaseModel):
    """Ответ на операции lock/extend-lock."""
    success: bool = True
    locked_until: str
    message: str


class LockConfigResponse(BaseModel):
    """Конфигурация блокировок."""
    lockDurationMinutes: int
    inactivityTimeoutMinutes: float
    inactivityCheckIntervalSeconds: int
    minExtensionIntervalMinutes: float
    inactivityDialogTimeoutSeconds: int


class InvoiceConfigResponse(BaseModel):
    """Конфигурация фактур."""
    hiveSchema: str
    gpSchema: str


class RestoreVersionResponse(BaseModel):
    """Ответ на восстановление версии."""
    success: bool = True
    message: str
    restored_version: int


class SaveContentResponse(BaseModel):
    """Ответ на сохранение содержимого."""
    status: str
    message: str
