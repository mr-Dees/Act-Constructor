"""
DI-зависимости домена чата.

Предоставляет фабрики сервисов для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.repositories.file_repository import FileRepository
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.settings import ChatDomainSettings


def _get_chat_settings() -> ChatDomainSettings:
    """Возвращает настройки домена чата из реестра."""
    return get_domain_settings("chat", ChatDomainSettings)


async def get_conversation_service() -> AsyncGenerator[ConversationService, None]:
    """Создаёт ConversationService с подключением из пула."""
    async with get_db() as conn:
        yield ConversationService(
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
        )


async def get_message_service() -> AsyncGenerator[MessageService, None]:
    """Создаёт MessageService с подключением из пула."""
    async with get_db() as conn:
        yield MessageService(
            msg_repo=MessageRepository(conn),
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
        )


async def get_file_service() -> AsyncGenerator[FileService, None]:
    """Создаёт FileService с подключением из пула."""
    async with get_db() as conn:
        yield FileService(
            file_repo=FileRepository(conn),
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
        )
