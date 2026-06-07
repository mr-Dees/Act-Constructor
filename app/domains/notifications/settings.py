"""Настройки домена центра уведомлений (env-префикс NOTIFICATIONS__)."""

from pydantic import BaseModel


class NotificationsSettings(BaseModel):
    """Параметры центра уведомлений, настраиваемые через NOTIFICATIONS__* в .env."""

    # Лимит уведомлений в списке по умолчанию (GET /api/v1/notifications?limit=).
    list_limit: int = 50
    # Срок хранения уведомлений в днях (для опциональной фоновой очистки;
    # в первой версии параметр заведён, но cleanup не реализован).
    retention_days: int = 90
