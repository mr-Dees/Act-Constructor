"""Сервис управления сообщениями чата."""

import logging
import uuid

from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.message")


class MessageService:
    """Бизнес-логика сообщений чата."""

    def __init__(
        self,
        *,
        msg_repo: MessageRepository,
        conv_repo: ConversationRepository,
        settings: ChatDomainSettings,
    ):
        self.msg_repo = msg_repo
        self.conv_repo = conv_repo
        self.settings = settings

    async def save_user_message(
        self,
        *,
        conversation_id: str,
        content: str,
        user_id: str,
        file_blocks: list[dict] | None = None,
    ) -> dict:
        """
        Сохраняет пользовательское сообщение.

        Проверяет длину контента и лимит сообщений в беседе.
        Собирает блоки: текстовый + опциональные файловые.
        """
        if len(content) > self.settings.max_message_content_length:
            raise ChatLimitError(
                f"Сообщение слишком длинное: {len(content)} символов "
                f"(максимум {self.settings.max_message_content_length})."
            )

        msg_count = await self.msg_repo.count_by_conversation(conversation_id)
        if msg_count >= self.settings.max_messages_per_conversation:
            raise ChatLimitError(
                f"Достигнут лимит сообщений в беседе: "
                f"{self.settings.max_messages_per_conversation}."
            )

        # Собираем блоки контента
        blocks: list[dict] = [{"type": "text", "content": content}]
        if file_blocks:
            blocks.extend(file_blocks)

        message_id = str(uuid.uuid4())
        message = await self.msg_repo.create(
            id=message_id,
            conversation_id=conversation_id,
            role="user",
            content=blocks,
        )

        await self.conv_repo.touch(conversation_id)
        return message

    async def save_assistant_message(
        self,
        *,
        conversation_id: str,
        content: list[dict],
        model: str | None = None,
        token_usage: dict | None = None,
    ) -> dict:
        """Сохраняет сообщение ассистента."""
        message_id = str(uuid.uuid4())
        message = await self.msg_repo.create(
            id=message_id,
            conversation_id=conversation_id,
            role="assistant",
            content=content,
            model=model,
            token_usage=token_usage,
        )

        await self.conv_repo.touch(conversation_id)
        return message

    async def get_history(
        self,
        conversation_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Возвращает историю сообщений беседы."""
        return await self.msg_repo.get_by_conversation(
            conversation_id, limit=limit, offset=offset,
        )
