"""Сервис-фасад для записи audit-лога жизненного цикла чата.

Сбой записи audit-лога НЕ должен ломать основную операцию: каждый метод
оборачивает обращение к репозиторию в ``try/except Exception`` и логирует
warning. По принципу 2.4.3 в ``docs/backend-audit-final.md``.
"""

from __future__ import annotations

import logging

from app.core.chat.names import (
    AUDIT_CONVERSATION_CREATED,
    AUDIT_CONVERSATION_DELETED,
    AUDIT_FILE_DELETED,
    AUDIT_FILE_UPLOADED,
    AUDIT_MESSAGE_SENT,
)
from app.core.metrics_batcher import MetricsBatcher
from app.domains.chat.repositories.chat_audit_log_repository import (
    ChatAuditLogRecord,
    ChatAuditLogRepository,
)

logger = logging.getLogger("audit_workstation.domains.chat.service.audit")


class ChatAuditService:
    """Фасад для записи audit-событий чата.

    Все методы безопасны: если запись в БД упала (сетевая ошибка, схема не
    создана, и т.п.), исключение проглатывается с warning-логом — сбой
    audit-лога не должен валить основную операцию пользователя.

    Если передан ``batcher`` — записи накапливаются в нём для bulk-INSERT.
    Иначе fallback на синхронный путь через ``repo.log()``.
    """

    def __init__(
        self,
        *,
        repo: ChatAuditLogRepository,
        batcher: MetricsBatcher[ChatAuditLogRecord] | None = None,
    ):
        self.repo = repo
        self._batcher = batcher

    async def _safe_log(
        self,
        *,
        username: str,
        action: str,
        conversation_id: str | None = None,
        details: dict | None = None,
    ) -> None:
        """Внутренний хелпер: пишет в БД, глуша любое исключение."""
        try:
            if self._batcher is not None:
                await self._batcher.add(
                    ChatAuditLogRecord(
                        username=username,
                        action=action,
                        conversation_id=conversation_id,
                        details=details,
                    )
                )
                return
            await self.repo.log(
                username=username,
                action=action,
                conversation_id=conversation_id,
                details=details,
            )
        except Exception:
            logger.warning(
                "Не удалось записать audit-log",
                extra={"action": action, "username": username},
                exc_info=True,
            )

    async def log_conversation_created(
        self,
        *,
        username: str,
        conversation_id: str,
        title: str | None = None,
        domain_name: str | None = None,
    ) -> None:
        """Логирует факт создания новой беседы."""
        details: dict = {}
        if title is not None:
            details["title"] = title
        if domain_name is not None:
            details["domain_name"] = domain_name
        await self._safe_log(
            username=username,
            action=AUDIT_CONVERSATION_CREATED,
            conversation_id=conversation_id,
            details=details or None,
        )

    async def log_conversation_deleted(
        self,
        *,
        username: str,
        conversation_id: str,
    ) -> None:
        """Логирует факт удаления беседы."""
        await self._safe_log(
            username=username,
            action=AUDIT_CONVERSATION_DELETED,
            conversation_id=conversation_id,
        )

    async def log_message_sent(
        self,
        *,
        username: str,
        conversation_id: str,
        message_id: str | None = None,
        content_length: int | None = None,
        files_count: int | None = None,
    ) -> None:
        """Логирует факт отправки пользовательского сообщения."""
        details: dict = {}
        if message_id is not None:
            details["message_id"] = message_id
        if content_length is not None:
            details["content_length"] = content_length
        if files_count is not None:
            details["files_count"] = files_count
        await self._safe_log(
            username=username,
            action=AUDIT_MESSAGE_SENT,
            conversation_id=conversation_id,
            details=details or None,
        )

    async def log_file_uploaded(
        self,
        *,
        username: str,
        conversation_id: str,
        file_id: str | None = None,
        filename: str | None = None,
        file_size: int | None = None,
        mime_type: str | None = None,
    ) -> None:
        """Логирует факт загрузки файла."""
        details: dict = {}
        if file_id is not None:
            details["file_id"] = file_id
        if filename is not None:
            details["filename"] = filename
        if file_size is not None:
            details["file_size"] = file_size
        if mime_type is not None:
            details["mime_type"] = mime_type
        await self._safe_log(
            username=username,
            action=AUDIT_FILE_UPLOADED,
            conversation_id=conversation_id,
            details=details or None,
        )

    async def log_file_deleted(
        self,
        *,
        username: str,
        conversation_id: str | None = None,
        file_id: str | None = None,
        filename: str | None = None,
    ) -> None:
        """Логирует факт удаления файла."""
        details: dict = {}
        if file_id is not None:
            details["file_id"] = file_id
        if filename is not None:
            details["filename"] = filename
        await self._safe_log(
            username=username,
            action=AUDIT_FILE_DELETED,
            conversation_id=conversation_id,
            details=details or None,
        )
