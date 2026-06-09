"""Админские эндпоинты аналитики чата (наблюдаемость диалогов и фидбэка).

Защищены ``require_admin()``. Размещены в chat-домене (а не admin), чтобы не
тащить кросс-доменный доступ к таблицам чата. Только чтение.
"""

import logging

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps.role_deps import require_admin
from app.domains.chat.deps import get_analytics_service
from app.domains.chat.services.chat_analytics_service import ChatAnalyticsService

logger = logging.getLogger("audit_workstation.domains.chat.api.admin_analytics")

router = APIRouter(dependencies=[Depends(require_admin())])


@router.get(
    "/admin/feedback/stats",
    summary="Статистика обратной связи чата",
)
async def feedback_stats(
    route_type: str | None = Query(None),
    agent_mode: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    service: ChatAnalyticsService = Depends(get_analytics_service),
):
    """Сводные метрики: всего/up/down/like_rate, срезы по маршруту/модели/причинам."""
    return await service.get_stats(
        route_type=route_type, agent_mode=agent_mode,
        date_from=date_from, date_to=date_to,
    )


@router.get(
    "/admin/feedback",
    summary="Список оценок сообщений (с текстом ответа)",
)
async def feedback_list(
    rating: str | None = Query(None, description="up / down; пусто — все"),
    route_type: str | None = Query(None),
    agent_mode: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    service: ChatAnalyticsService = Depends(get_analytics_service),
):
    """Пагинированный список оценок с предпросмотром ответа. Для анализа дизлайков."""
    return await service.list_feedback(
        rating=rating, route_type=route_type, agent_mode=agent_mode,
        date_from=date_from, date_to=date_to, limit=limit, offset=offset,
    )


@router.get(
    "/admin/conversations/{conversation_id}/inspect",
    summary="Инспектор диалога (сообщения + маршрут + оценки)",
)
async def inspect_conversation(
    conversation_id: str,
    service: ChatAnalyticsService = Depends(get_analytics_service),
):
    """Полный диалог: что спрашивали/получали, маршрут ответа, исход, оценки."""
    return await service.inspect_conversation(conversation_id)
