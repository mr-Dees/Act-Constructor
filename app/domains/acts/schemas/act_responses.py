"""Pydantic-модели ответов API."""

from datetime import datetime

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
    """Ответ на сохранение содержимого.

    updated_at — серверная метка обновления акта после сохранения; фронт
    запоминает её как базу метаданных снимка-черновика localStorage
    (baseUpdatedAt) для решения о восстановлении черновика (H3).

    warning — мягкое предупреждение пользователю, когда при сохранении
    автоматически вычищено рассогласование дерево ↔ словари (висячие ссылки
    узлов и/или записи словарей без узла-владельца). null — ничего не чистилось.
    Сохранение в обоих случаях успешно (status='success'): обе стороны
    рассогласования лечатся мягко, а не отбивают весь PUT 422. Фронт читает
    result.warning.

    validation_status / validation_issues — состояние структурной валидации
    акта, вычисленное бэком на этом сохранении (источник истины). 'ok' —
    акт заполнен корректно; 'needs_review' — есть замечания (список issues с
    code/severity/message/ref). WIP-сохранение в БД НЕ блокируется: акт
    сохраняется и помечается статусом, конкретику фронт показывает в
    уведомлениях и на карточке.
    """
    status: str
    message: str
    updated_at: datetime | None = None
    warning: str | None = None
    validation_status: str = "ok"
    validation_issues: list[dict] = []
