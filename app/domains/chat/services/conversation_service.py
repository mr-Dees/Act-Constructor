"""Сервис управления беседами чата."""

import logging
import uuid

from fastapi import HTTPException

from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.conversation")


class ConversationService:
    """Бизнес-логика управления беседами."""

    def __init__(
        self,
        *,
        conv_repo: ConversationRepository,
        settings: ChatDomainSettings,
    ):
        self.conv_repo = conv_repo
        self.settings = settings

    async def create(
        self,
        *,
        user_id: str,
        title: str | None = None,
        domain_name: str | None = None,
        context: dict | None = None,
    ) -> dict:
        """Создаёт новую беседу с проверкой лимита."""
        count = await self.conv_repo.count_by_user(user_id)
        if count >= self.settings.max_conversations_per_user:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Достигнут лимит бесед: {self.settings.max_conversations_per_user}. "
                    f"Удалите старые беседы перед созданием новых."
                ),
            )

        conversation_id = str(uuid.uuid4())
        return await self.conv_repo.create(
            id=conversation_id,
            user_id=user_id,
            title=title,
            domain_name=domain_name,
            context=context,
        )

    async def get_list(
        self,
        user_id: str,
        *,
        domain_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """Возвращает список бесед пользователя."""
        return await self.conv_repo.get_by_user(
            user_id, domain_name=domain_name, limit=limit, offset=offset,
        )

    async def get(self, conversation_id: str, user_id: str) -> dict:
        """
        Возвращает беседу по ID.

        Raises:
            HTTPException(404): если беседа не найдена или не принадлежит пользователю.
        """
        conversation = await self.conv_repo.get_by_id(conversation_id, user_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="Беседа не найдена")
        return conversation

    async def update_title(
        self, conversation_id: str, user_id: str, title: str,
    ) -> bool:
        """Обновляет заголовок беседы."""
        return await self.conv_repo.update_title(conversation_id, user_id, title)

    async def delete(self, conversation_id: str, user_id: str) -> bool:
        """Удаляет беседу."""
        return await self.conv_repo.delete(conversation_id, user_id)
