"""Репозиторий сообщений чата."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.message")


class MessageRepository(BaseRepository):
    """CRUD-операции с сообщениями чата."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("chat_messages")

    @staticmethod
    def _parse_row(row: dict) -> dict:
        """Парсит JSONB-поля из строк в Python-объекты."""
        result = dict(row)
        for key in ("content", "token_usage"):
            val = result.get(key)
            if isinstance(val, str):
                try:
                    result[key] = json.loads(val)
                except json.JSONDecodeError:
                    result[key] = None
        return result

    async def create(
        self,
        *,
        id: str,
        conversation_id: str,
        role: str,
        content: list[dict],
        model: str | None = None,
        token_usage: dict | None = None,
    ) -> dict:
        """Создаёт новое сообщение и возвращает запись."""
        row = await self.conn.fetchrow(
            f"""
            INSERT INTO {self.table}
                (id, conversation_id, role, content, model, token_usage)
            VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)
            RETURNING *
            """,
            id,
            conversation_id,
            role,
            json.dumps(content, ensure_ascii=False),
            model,
            json.dumps(token_usage, ensure_ascii=False) if token_usage else None,
        )
        return self._parse_row(row)

    async def get_by_conversation(
        self,
        conversation_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict]:
        """Возвращает сообщения беседы в хронологическом порядке."""
        rows = await self.conn.fetch(
            f"""
            SELECT * FROM {self.table}
            WHERE conversation_id = $1
            ORDER BY created_at ASC
            LIMIT $2 OFFSET $3
            """,
            conversation_id,
            limit,
            offset,
        )
        return [self._parse_row(r) for r in rows]

    async def count_by_conversation(self, conversation_id: str) -> int:
        """Возвращает количество сообщений в беседе."""
        return await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.table} WHERE conversation_id = $1",
            conversation_id,
        )
