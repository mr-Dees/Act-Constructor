"""Репозиторий bus-таблицы agent_messages (канал к внешнему агенту)."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.agent_message")

# Поля, хранящиеся как JSONB и требующие десериализации при чтении.
_JSONB_FIELDS = ("media", "metadata", "buttons")


class AgentMessageRepository(BaseRepository):
    """CRUD-операции с bus-таблицей agent_messages."""

    def __init__(self, conn: asyncpg.Connection, table_name: str = "agent_messages"):
        super().__init__(conn)
        self.table = self.adapter.get_table_name(table_name)

    @staticmethod
    def _parse_row(row) -> dict | None:
        """Парсит JSONB-поля из строк в Python-объекты."""
        if row is None:
            return None
        result = dict(row)
        for key in _JSONB_FIELDS:
            val = result.get(key)
            if isinstance(val, str):
                try:
                    result[key] = json.loads(val)
                except json.JSONDecodeError:
                    result[key] = None
        return result

    async def insert_question(
        self,
        *,
        id: str,
        chat_id: str,
        user_id: str,
        conversation_id: str,
        content: str,
        metadata: dict | None = None,
        media: list | None = None,
    ) -> dict:
        """Вставляет строку-вопрос от AW к агенту со статусом 'pending'.

        Возвращает вставленную запись со всеми колонками.
        """
        row = await self.conn.fetchrow(
            f"""
            INSERT INTO {self.table}
                (id, chat_id, user_id, conversation_id, role, content,
                 media, metadata, status)
            VALUES ($1, $2, $3, $4, 'user', $5, $6::jsonb, $7::jsonb, 'pending')
            RETURNING *
            """,
            id,
            chat_id,
            user_id,
            conversation_id,
            content,
            json.dumps(media, ensure_ascii=False) if media is not None else None,
            json.dumps(metadata or {}, ensure_ascii=False),
        )
        return self._parse_row(row)

    async def get_by_uid(self, conversation_id: str) -> dict | None:
        """Возвращает строку по conversation_id (uid одного сообщения)."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} WHERE conversation_id = $1",
            conversation_id,
        )
        return self._parse_row(row)

    async def get_questions(self, uids: list[str]) -> list[dict]:
        """Возвращает строки по списку conversation_id (uid сообщений).

        Пустой список uids → возвращает [] без обращения к БД.
        """
        if not uids:
            return []
        rows = await self.conn.fetch(
            f"SELECT * FROM {self.table} WHERE conversation_id = ANY($1::varchar[])",
            uids,
        )
        return [self._parse_row(r) for r in rows]

    async def set_status(self, *, conversation_id: str, status: str) -> None:
        """Обновляет статус строки по conversation_id."""
        await self.conn.execute(
            f"UPDATE {self.table} SET status = $1, updated_at = CURRENT_TIMESTAMP "
            f"WHERE conversation_id = $2",
            status,
            conversation_id,
        )

    async def count_active_for_user(self, user_id: str) -> int:
        """Считает активные (pending / in_progress) запросы пользователя в bus-таблице."""
        val = await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.table} "
            f"WHERE user_id = $1 AND status IN ('pending', 'in_progress')",
            user_id,
        )
        return int(val or 0)
