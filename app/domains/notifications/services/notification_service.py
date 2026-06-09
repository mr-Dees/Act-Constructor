"""Сервис центра уведомлений."""

import uuid

import asyncpg

from app.domains.notifications.repositories.notification_repository import (
    NotificationRepository,
)


class NotificationService:
    """Бизнес-логика центра уведомлений.

    Тонкая обёртка над репозиторием: делегирует выборки/пометки и генерирует
    id при создании уведомления (``push``). Принимает соединение из пула.
    """

    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn
        self.repo = NotificationRepository(conn)

    async def list_for_user(self, user_id: str, *, limit: int = 50) -> list[dict]:
        """Возвращает видимые пользователю уведомления (адресные + broadcast)."""
        return await self.repo.list_for_user(user_id, limit=limit)

    async def unread_summary(self, user_id: str) -> dict:
        """Число непрочитанных видимых уведомлений и их максимальная критичность.

        Возвращает ``{"count": int, "severity": "error"|"warning"|"info"|None}``.
        """
        return await self.repo.unread_summary(user_id)

    async def mark_read(self, notification_id: str, user_id: str) -> None:
        """Помечает уведомление прочитанным."""
        await self.repo.mark_read(notification_id, user_id)

    async def mark_all_read(self, user_id: str) -> None:
        """Помечает все видимые уведомления пользователя прочитанными."""
        await self.repo.mark_all_read(user_id)

    async def dismiss(self, notification_id: str, user_id: str) -> None:
        """Скрывает уведомление для пользователя."""
        await self.repo.dismiss(notification_id, user_id)

    async def push(
        self,
        *,
        source: str,
        title: str,
        severity: str = "info",
        body: str | None = None,
        link: str | None = None,
        element_ref: str | None = None,
        recipient_user_id: str | None = None,
        created_by: str = "system",
    ) -> str:
        """Создаёт уведомление и возвращает его id.

        ``recipient_user_id=None`` → broadcast всем. id генерится здесь
        (``str(uuid.uuid4())``); ``created_by`` по умолчанию ``'system'``
        (продьюсеры передают свой источник, API — текущий username).
        """
        return await self.repo.create(
            id=str(uuid.uuid4()),
            source=source,
            title=title,
            severity=severity,
            body=body,
            link=link,
            element_ref=element_ref,
            recipient_user_id=recipient_user_id,
            created_by=created_by,
        )
