"""DI-зависимости домена центра уведомлений.

Фабрика сервиса для FastAPI Depends: оборачивает get_db()
(asynccontextmanager) в async-генератор.
"""

from collections.abc import AsyncGenerator

from app.db.connection import get_db
from app.domains.notifications.services.notification_service import (
    NotificationService,
)


async def get_notification_service() -> AsyncGenerator[NotificationService, None]:
    """Создаёт NotificationService с подключением из пула."""
    async with get_db() as conn:
        yield NotificationService(conn)
