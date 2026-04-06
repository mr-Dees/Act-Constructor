"""Репозиторий бесед чата."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.conversation")


class ConversationRepository(BaseRepository):
    """CRUD-операции с беседами чата."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("chat_conversations")

    async def create(
        self,
        *,
        id: str,
        user_id: str,
        title: str | None = None,
        domain_name: str | None = None,
        context: dict | None = None,
    ) -> dict:
        """Создаёт новую беседу и возвращает запись."""
        row = await self.conn.fetchrow(
            f"""
            INSERT INTO {self.table} (id, user_id, title, domain_name, context)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            RETURNING *
            """,
            id,
            user_id,
            title,
            domain_name,
            json.dumps(context, ensure_ascii=False) if context else None,
        )
        return dict(row)

    async def get_by_id(self, conversation_id: str, user_id: str) -> dict | None:
        """Возвращает беседу по ID с проверкой владельца."""
        row = await self.conn.fetchrow(
            f"""
            SELECT * FROM {self.table}
            WHERE id = $1 AND user_id = $2
            """,
            conversation_id,
            user_id,
        )
        return dict(row) if row else None

    async def get_by_user(
        self,
        user_id: str,
        *,
        domain_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """Возвращает беседы пользователя, отсортированные по дате обновления."""
        if domain_name:
            rows = await self.conn.fetch(
                f"""
                SELECT * FROM {self.table}
                WHERE user_id = $1 AND domain_name = $2
                ORDER BY updated_at DESC
                LIMIT $3 OFFSET $4
                """,
                user_id,
                domain_name,
                limit,
                offset,
            )
        else:
            rows = await self.conn.fetch(
                f"""
                SELECT * FROM {self.table}
                WHERE user_id = $1
                ORDER BY updated_at DESC
                LIMIT $2 OFFSET $3
                """,
                user_id,
                limit,
                offset,
            )
        return [dict(r) for r in rows]

    async def update_title(
        self, conversation_id: str, user_id: str, title: str,
    ) -> bool:
        """Обновляет заголовок беседы. Возвращает True если запись обновлена."""
        result = await self.conn.execute(
            f"""
            UPDATE {self.table}
            SET title = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND user_id = $3
            """,
            title,
            conversation_id,
            user_id,
        )
        return result == "UPDATE 1"

    async def touch(self, conversation_id: str) -> None:
        """Обновляет updated_at беседы."""
        await self.conn.execute(
            f"""
            UPDATE {self.table}
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            """,
            conversation_id,
        )

    async def delete(self, conversation_id: str, user_id: str) -> bool:
        """Удаляет беседу. Возвращает True если запись удалена."""
        result = await self.conn.execute(
            f"""
            DELETE FROM {self.table}
            WHERE id = $1 AND user_id = $2
            """,
            conversation_id,
            user_id,
        )
        return result == "DELETE 1"

    async def count_by_user(self, user_id: str) -> int:
        """Возвращает количество бесед пользователя."""
        return await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.table} WHERE user_id = $1",
            user_id,
        )
