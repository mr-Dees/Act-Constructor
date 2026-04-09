"""Эндпоинты управления беседами."""

import logging

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps.auth_deps import get_username
from app.domains.chat.deps import get_conversation_service
from app.domains.chat.schemas.requests import (
    CreateConversationRequest,
    UpdateConversationRequest,
)
from app.domains.chat.schemas.responses import (
    ConversationListItem,
    ConversationResponse,
)
from app.domains.chat.services.conversation_service import ConversationService

logger = logging.getLogger("audit_workstation.domains.chat.api.conversations")

router = APIRouter()


@router.post(
    "/conversations",
    response_model=ConversationResponse,
    status_code=201,
    summary="Создать беседу",
)
async def create_conversation(
    body: CreateConversationRequest,
    username: str = Depends(get_username),
    service: ConversationService = Depends(get_conversation_service),
):
    """Создаёт новую беседу."""
    logger.info("Создание беседы пользователем %s", username)
    conversation = await service.create(
        user_id=username,
        title=body.title,
        domain_name=body.domain_name,
        context=body.context,
    )
    return conversation


@router.get(
    "/conversations",
    response_model=list[ConversationListItem],
    summary="Список бесед",
)
async def list_conversations(
    domain_name: str | None = Query(None, description="Фильтр по домену"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    username: str = Depends(get_username),
    service: ConversationService = Depends(get_conversation_service),
):
    """Возвращает список бесед пользователя."""
    return await service.get_list(
        username,
        domain_name=domain_name,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    summary="Получить беседу",
)
async def get_conversation(
    conversation_id: str,
    username: str = Depends(get_username),
    service: ConversationService = Depends(get_conversation_service),
):
    """Возвращает беседу по ID."""
    return await service.get(conversation_id, username)


@router.patch(
    "/conversations/{conversation_id}",
    summary="Обновить заголовок беседы",
)
async def update_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    username: str = Depends(get_username),
    service: ConversationService = Depends(get_conversation_service),
):
    """Обновляет заголовок беседы."""
    updated = await service.update_title(conversation_id, username, body.title)
    return {"updated": updated}


@router.delete(
    "/conversations/{conversation_id}",
    summary="Удалить беседу",
)
async def delete_conversation(
    conversation_id: str,
    username: str = Depends(get_username),
    service: ConversationService = Depends(get_conversation_service),
):
    """Удаляет беседу и все связанные данные."""
    logger.info("Удаление беседы %s пользователем %s", conversation_id, username)
    deleted = await service.delete(conversation_id, username)
    return {"deleted": deleted}
