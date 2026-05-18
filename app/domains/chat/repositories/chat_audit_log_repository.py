"""Репозиторий audit-лога жизненного цикла беседы."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger(
    "audit_workstation.domains.chat.repo.audit_log"
)


class ChatAuditLogRepository(BaseRepository):
    """Append-only журнал действий пользователей в чате."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("chat_audit_log")

    async def log(
        self,
        *,
        username: str,
        action: str,
        conversation_id: str | None = None,
        details: dict | None = None,
    ) -> None:
        """Записывает одну строку audit-лога.

        :param username: имя пользователя, выполнившего действие.
        :param action: одно из значений из ``app.core.chat.names`` (``AUDIT_*``).
        :param conversation_id: id беседы (если применимо).
        :param details: произвольный dict, сериализуется в JSONB.
        """
        details_json = (
            json.dumps(details, ensure_ascii=False, default=str)
            if details is not None
            else None
        )
        await self.conn.execute(
            f"""
            INSERT INTO {self.table}
                (username, action, conversation_id, details_json)
            VALUES ($1, $2, $3, $4::jsonb)
            """,
            username,
            action,
            conversation_id,
            details_json,
        )
