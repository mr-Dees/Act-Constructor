"""Эндпоинты центра уведомлений.

Колокольчик общий для всех страниц, поэтому эндпоинты защищены только
авторизацией (``Depends(get_username)``) — без доменного гейта на уровне
самого роутера.
"""

import logging

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps.auth_deps import get_username
from app.domains.notifications.deps import get_notification_service
from app.domains.notifications.schemas import (
    NotificationCreate,
    NotificationOut,
    UnreadCount,
)
from app.domains.notifications.services.notification_service import (
    NotificationService,
)

logger = logging.getLogger("audit_workstation.domains.notifications.api")

router = APIRouter()


@router.get("", response_model=list[NotificationOut], summary="Список уведомлений")
async def list_notifications(
    limit: int = Query(50, ge=1, le=200),
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Возвращает видимые пользователю уведомления (адресные + broadcast).

    Скрытые исключены, сортировка по дате создания DESC.
    """
    return await service.list_for_user(username, limit=limit)


@router.get(
    "/unread-count",
    response_model=UnreadCount,
    summary="Число непрочитанных",
)
async def get_unread_count(
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Возвращает число непрочитанных видимых уведомлений пользователя."""
    count = await service.unread_count(username)
    return UnreadCount(count=count)


@router.post("/{notification_id}/read", summary="Пометить прочитанным")
async def mark_read(
    notification_id: str,
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Помечает уведомление прочитанным для текущего пользователя."""
    await service.mark_read(notification_id, username)
    return {"ok": True}


@router.post("/read-all", summary="Пометить все прочитанными")
async def mark_all_read(
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Помечает все видимые уведомления пользователя прочитанными."""
    await service.mark_all_read(username)
    return {"ok": True}


@router.post("/{notification_id}/dismiss", summary="Скрыть уведомление")
async def dismiss(
    notification_id: str,
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Скрывает уведомление для текущего пользователя."""
    await service.dismiss(notification_id, username)
    return {"ok": True}


@router.post("", summary="Создать уведомление")
async def create_notification(
    payload: NotificationCreate,
    username: str = Depends(get_username),
    service: NotificationService = Depends(get_notification_service),
):
    """Создаёт уведомление. ``created_by`` = текущий username.

    ``recipient_user_id=None`` → broadcast всем. Любой авторизованный может
    создать уведомление (адресное себе/другому или broadcast).
    """
    notification_id = await service.push(
        source=payload.source,
        title=payload.title,
        severity=payload.severity,
        body=payload.body,
        link=payload.link,
        element_ref=payload.element_ref,
        recipient_user_id=payload.recipient_user_id,
        created_by=username,
    )
    return {"id": notification_id}
