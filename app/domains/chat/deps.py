"""
DI-зависимости домена чата.

Предоставляет фабрики сервисов для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.core.settings_registry import get as get_domain_settings
from app.db.connection import get_db
from app.domains.chat.repositories.chat_audit_log_repository import (
    ChatAuditLogRepository,
)
from app.domains.chat.repositories.chat_tool_metrics_repository import (
    ChatToolMetricsRepository,
)
from app.domains.chat.repositories.conversation_repository import ConversationRepository
from app.domains.chat.repositories.file_repository import FileRepository
from app.domains.chat.repositories.message_repository import MessageRepository
from app.domains.chat.services.chat_audit_service import ChatAuditService
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.services.user_rate_limiter import UserRateLimiter
from app.domains.chat.settings import ChatDomainSettings

# Singleton лимитера — создаётся при первом обращении, limit читается из settings.
# Lazy init: при смене настроек в тестах достаточно выставить _rate_limiter = None.
_rate_limiter: UserRateLimiter | None = None


def _get_chat_settings() -> ChatDomainSettings:
    """Возвращает настройки домена чата из реестра."""
    return get_domain_settings("chat", ChatDomainSettings)


def get_rate_limiter() -> UserRateLimiter:
    """Возвращает singleton UserRateLimiter с лимитом из текущих настроек.

    Если домен chat не зарегистрирован в settings_registry (например, в тестах),
    создаёт лимитер с дефолтными значениями ChatDomainSettings.
    """
    global _rate_limiter
    if _rate_limiter is None:
        try:
            settings = _get_chat_settings()
        except KeyError:
            settings = ChatDomainSettings()
        _rate_limiter = UserRateLimiter(
            limit=settings.rate_limit_messages_per_minute_per_user,
        )
    return _rate_limiter


async def get_conversation_service() -> AsyncGenerator[ConversationService, None]:
    """Создаёт ConversationService с подключением из пула.

    audit_service подключается на том же соединении: запись audit-лога
    идёт в той же сессии БД, что и основная операция сервиса.
    """
    async with get_db() as conn:
        audit = ChatAuditService(repo=ChatAuditLogRepository(conn))
        yield ConversationService(
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
            audit_service=audit,
        )


async def get_message_service() -> AsyncGenerator[MessageService, None]:
    """Создаёт MessageService с подключением из пула."""
    async with get_db() as conn:
        audit = ChatAuditService(repo=ChatAuditLogRepository(conn))
        yield MessageService(
            msg_repo=MessageRepository(conn),
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
            audit_service=audit,
        )


async def get_file_service() -> AsyncGenerator[FileService, None]:
    """Создаёт FileService с подключением из пула."""
    async with get_db() as conn:
        audit = ChatAuditService(repo=ChatAuditLogRepository(conn))
        yield FileService(
            file_repo=FileRepository(conn),
            conv_repo=ConversationRepository(conn),
            settings=_get_chat_settings(),
            audit_service=audit,
        )


async def get_tool_metrics_repository() -> AsyncGenerator[
    ChatToolMetricsRepository, None,
]:
    """Создаёт ChatToolMetricsRepository с подключением из пула.

    Использовать как контекстный async-generator (паттерн ``async for ... in``);
    каждый вызов берёт новое соединение из пула на одну операцию ``record``.
    """
    async with get_db() as conn:
        yield ChatToolMetricsRepository(conn)


async def get_audit_service() -> AsyncGenerator[ChatAuditService, None]:
    """Создаёт ChatAuditService с подключением из пула.

    Сервис глушит исключения внутри; вызывающим не нужно оборачивать в try.
    """
    async with get_db() as conn:
        yield ChatAuditService(repo=ChatAuditLogRepository(conn))
