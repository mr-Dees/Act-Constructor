"""Эндпоинты обратной связи по сообщениям ассистента (лайк/дизлайк)."""

import logging

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import (
    get_conversation_service,
    get_feedback_service,
    get_message_service,
)
from app.domains.chat.schemas.requests import MessageFeedbackRequest
from app.domains.chat.schemas.responses import MessageFeedbackResponse
from app.domains.chat.services.chat_feedback_service import (
    ChatFeedbackService,
    feedback_public_dict,
)
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.message_service import MessageService

logger = logging.getLogger("audit_workstation.domains.chat.api.feedback")

# Защита роли крепится явно на роутер (defense in depth) — как в messages.py.
router = APIRouter(dependencies=[Depends(require_domain_access("chat"))])


@router.put(
    "/conversations/{conversation_id}/messages/{message_id}/feedback",
    response_model=MessageFeedbackResponse,
    summary="Оценить ответ ассистента (полезно/не полезно)",
)
async def put_feedback(
    conversation_id: str,
    message_id: str,
    body: MessageFeedbackRequest,
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
    feedback_service: ChatFeedbackService = Depends(get_feedback_service),
):
    """Ставит/меняет оценку сообщения ассистента (идемпотентно по пользователю).

    Проверяет владение беседой и принадлежность сообщения ей. Оценивать можно
    только ответы ассистента (role='assistant').
    """
    # Владение беседой (404, если чужая/нет).
    await conv_service.get(conversation_id, username)
    # Принадлежность сообщения беседе + загрузка (404, если чужое/нет).
    message = await msg_service.get_message(conversation_id, message_id)

    saved = await feedback_service.submit(
        message=message,
        user_id=username,
        rating=body.rating,
        reasons=body.reasons,
        comment=body.comment,
        agent_mode=body.agent_mode,
    )
    logger.info(
        "Оценка сообщения: conversation=%s message=%s rating=%s",
        conversation_id, message_id, body.rating,
    )
    return MessageFeedbackResponse(feedback=feedback_public_dict(saved))


@router.delete(
    "/conversations/{conversation_id}/messages/{message_id}/feedback",
    response_model=MessageFeedbackResponse,
    summary="Снять оценку ответа ассистента",
)
async def delete_feedback(
    conversation_id: str,
    message_id: str,
    username: str = Depends(get_username),
    conv_service: ConversationService = Depends(get_conversation_service),
    msg_service: MessageService = Depends(get_message_service),
    feedback_service: ChatFeedbackService = Depends(get_feedback_service),
):
    """Снимает оценку текущего пользователя на сообщение. Идемпотентно."""
    await conv_service.get(conversation_id, username)
    # Принадлежность сообщения беседе (404, если чужое/нет).
    await msg_service.get_message(conversation_id, message_id)

    await feedback_service.clear(
        conversation_id=conversation_id,
        message_id=message_id,
        user_id=username,
    )
    return MessageFeedbackResponse(feedback=None)
