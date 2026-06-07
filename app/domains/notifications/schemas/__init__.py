"""Pydantic-схемы домена центра уведомлений."""

from datetime import datetime

from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    """Уведомление в ответе списка (GET /api/v1/notifications)."""

    id: str
    source: str
    severity: str
    title: str
    body: str | None = None
    link: str | None = None
    element_ref: str | None = None
    created_at: datetime
    is_read: bool


class NotificationCreate(BaseModel):
    """Тело запроса на создание уведомления (POST /api/v1/notifications).

    ``recipient_user_id=None`` → broadcast всем. ``created_by`` проставляется
    эндпоинтом из текущего username, в теле не принимается.
    """

    recipient_user_id: str | None = None
    source: str
    severity: str = "info"
    title: str
    body: str | None = None
    link: str | None = None
    element_ref: str | None = None


class UnreadCount(BaseModel):
    """Число непрочитанных уведомлений (GET /api/v1/notifications/unread-count)."""

    count: int = Field(ge=0)
