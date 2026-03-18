"""
Репозиторий аудит-лога.

Записывает чувствительные операции для compliance-отчётности.
"""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("act_constructor.db.repository.audit_log")


class ActAuditLogRepository(BaseRepository):
    """Запись операций в аудит-лог."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.audit_log = self.adapter.get_table_name("audit_log")

    async def log(
        self,
        action: str,
        username: str,
        act_id: int | None = None,
        details: dict | None = None,
    ) -> None:
        """
        Записывает операцию в аудит-лог.

        Args:
            action: Тип операции (create, update, delete, duplicate, lock, unlock)
            username: Пользователь
            act_id: ID акта (опционально)
            details: Дополнительные данные (опционально)
        """
        details_json = json.dumps(details or {}, ensure_ascii=False, default=str)
        try:
            await self.conn.execute(
                f"""
                INSERT INTO {self.audit_log} (act_id, action, username, details)
                VALUES ($1, $2, $3, $4::jsonb)
                """,
                act_id,
                action,
                username,
                details_json,
            )
        except Exception:
            # Ошибка записи аудит-лога не должна блокировать основную операцию
            logger.exception(
                f"Не удалось записать аудит-лог: action={action}, "
                f"act_id={act_id}, username={username}"
            )
