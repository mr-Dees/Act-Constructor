"""
Эндпоинт чата с AI-ассистентом.

Принимает сообщения пользователя и возвращает ответы.
Текущая реализация — заглушка (эхо-ответ).
"""

import logging

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.schemas.chat import ChatRequest, ChatResponse

logger = logging.getLogger("act_constructor.chat")

router = APIRouter()


@router.post("/message", response_model=ChatResponse)
async def send_message(
    request: ChatRequest,
    username: str = Depends(get_username),
):
    """
    Отправить сообщение AI-ассистенту.

    Текущая реализация — заглушка, возвращающая эхо-ответ.
    """
    logger.info("Сообщение чата от %s: %s", username, request.message[:100])

    response_text = f'Вы написали: «{request.message}»'

    if request.act_id is not None:
        response_text += f'\n\nКонтекст: акт #{request.act_id}'

    if request.knowledge_bases:
        response_text += '\n\nПодключённые базы знаний: ' + ', '.join(request.knowledge_bases)
    else:
        response_text += '\n\nБазы знаний не подключены'

    response_text += '\n\nAI-ассистент в разработке. Полноценные ответы появятся в следующих версиях.'

    return ChatResponse(response=response_text)
