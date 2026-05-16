"""Сервис управления беседами чата."""

import asyncio
import logging
import uuid

from app.domains.chat.exceptions import (
    ChatLimitError,
    ConversationLockedError,
    ConversationNotFoundError,
)
from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.service.conversation")


# Process-level per-user локи для критичных секций (count_by_user + create,
# проверка стрима + delete). Корректны в режиме single-worker (см.
# app/core/singleton_lock.py): дикт живёт в одном процессе uvicorn.
# В multi-worker нужен advisory lock в БД — пока не требуется.
_user_locks: dict[str, asyncio.Lock] = {}


def _get_user_lock(user_id: str) -> asyncio.Lock:
    """Возвращает (создавая при необходимости) lock для пользователя.

    Lock'и кэшируются per-user — конкурентные операции разных пользователей
    не блокируют друг друга. Создание `asyncio.Lock()` без активного loop'а
    допустимо в Python 3.10+ (биндинг к loop'у происходит при первом await).
    """
    lock = _user_locks.get(user_id)
    if lock is None:
        lock = asyncio.Lock()
        _user_locks[user_id] = lock
    return lock


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
        """Создаёт новую беседу с проверкой лимита.

        Критическая секция (count_by_user + create) обёрнута в per-user
        asyncio.Lock — это устраняет race condition при конкурентных
        запросах одного пользователя (BUG #9, #14): счётчик и факт
        существования беседы по title читаются и обновляются атомарно.

        Если у пользователя уже есть беседа с тем же `title` — она и
        возвращается (server-side идемпотентность для ensureConversation).
        """
        async with _get_user_lock(user_id):
            # Server-side идемпотентность: при заданном title не плодим
            # дубликатов от конкурентных ensureConversation на фронте.
            if title is not None and hasattr(self.conv_repo, "get_by_user_and_title"):
                existing = await self.conv_repo.get_by_user_and_title(user_id, title)
                if existing:
                    return existing

            count = await self.conv_repo.count_by_user(user_id)
            if count >= self.settings.max_conversations_per_user:
                raise ChatLimitError(
                    f"Достигнут лимит бесед: {self.settings.max_conversations_per_user}. "
                    f"Удалите старые беседы перед созданием новых."
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
            ConversationNotFoundError: если беседа не найдена или не принадлежит пользователю.
        """
        conversation = await self.conv_repo.get_by_id(conversation_id, user_id)
        if not conversation:
            raise ConversationNotFoundError("Беседа не найдена")
        return conversation

    async def update_title(
        self, conversation_id: str, user_id: str, title: str,
    ) -> bool:
        """Обновляет заголовок беседы."""
        return await self.conv_repo.update_title(conversation_id, user_id, title)

    async def delete(self, conversation_id: str, user_id: str) -> bool:
        """Удаляет беседу.

        Бросает ConversationLockedError, если у пользователя есть активный
        SSE-стрим — иначе генератор продолжит писать сообщения в уже
        удалённую беседу (BUG #15). Импорт is_user_streaming сделан
        внутри функции, чтобы избежать циклов и позволить патчить в тестах.
        """
        # Ленивая загрузка — api.messages импортирует наш модуль (через deps),
        # потому module-level import создал бы цикл.
        from app.domains.chat.api.messages import is_user_streaming

        if is_user_streaming(user_id):
            raise ConversationLockedError(
                "Невозможно удалить беседу: идёт генерация ответа ассистента. "
                "Дождитесь окончания стрима и повторите."
            )
        return await self.conv_repo.delete(conversation_id, user_id)
