"""DI-зависимости домена центра уведомлений.

Фабрика сервиса для FastAPI Depends: оборачивает get_db()
(asynccontextmanager) в async-генератор.
"""

from collections.abc import AsyncGenerator

from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.notifications.services.notification_service import (
    NotificationService,
)
from app.domains.notifications.settings import NotificationsSettings


async def get_notification_service() -> AsyncGenerator[NotificationService, None]:
    """Создаёт NotificationService с подключением из пула."""
    async with get_db() as conn:
        yield NotificationService(conn)


def get_notifications_settings() -> NotificationsSettings:
    """Возвращает настройки домена уведомлений из реестра настроек."""
    from app.domains.notifications import DOMAIN_NAME
    return get_domain_settings(DOMAIN_NAME, NotificationsSettings)
