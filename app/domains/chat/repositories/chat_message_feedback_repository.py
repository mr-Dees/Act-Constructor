"""Репозиторий обратной связи по сообщениям ассистента (лайк/дизлайк).

Таблица ``chat_message_feedback`` идемпотентна по паре ``(message_id, user_id)``
(составной PRIMARY KEY). UPSERT реализован как read-modify-write в транзакции
(на Greenplum нет ``ON CONFLICT``). Конкурентные оценки одного пользователя
сериализуются в сервисе через per-user lock — гонки INSERT/INSERT не возникает.
"""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository
from app.domains.chat.settings import resolve_chat_schema

logger = logging.getLogger("audit_workstation.domains.chat.repo.feedback")


class ChatMessageFeedbackRepository(BaseRepository):
    """CRUD обратной связи по сообщениям ассистента."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name(
            "chat_message_feedback", schema=resolve_chat_schema(),
        )

    @staticmethod
    def _parse_row(row) -> dict:
        """Десериализует JSONB-поле ``reasons`` из строки в Python-список."""
        result = dict(row)
        val = result.get("reasons")
        if isinstance(val, str):
            try:
                result["reasons"] = json.loads(val)
            except json.JSONDecodeError:
                result["reasons"] = None
        return result

    async def upsert(
        self,
        *,
        conversation_id: str,
        message_id: str,
        user_id: str,
        rating: str,
        reasons: list[str] | None = None,
        comment: str | None = None,
        source: str = "user",
        route_type: str | None = None,
        agent_mode: str | None = None,
        model: str | None = None,
    ) -> dict:
        """Создаёт или обновляет оценку пользователя на сообщение.

        Read-modify-write в транзакции (GP-совместимо, без ``ON CONFLICT``).
        Вызывающий сервис обязан держать per-user lock, чтобы конкурентные
        оценки одного пользователя не привели к гонке INSERT/INSERT.
        """
        reasons_json = (
            json.dumps(reasons, ensure_ascii=False) if reasons else None
        )
        async with self.conn.transaction():
            existing = await self.conn.fetchrow(
                f"SELECT 1 FROM {self.table} "
                f"WHERE message_id = $1 AND user_id = $2",
                message_id,
                user_id,
            )
            if existing is None:
                row = await self.conn.fetchrow(
                    f"""
                    INSERT INTO {self.table}
                        (conversation_id, message_id, user_id, rating, reasons,
                         comment, source, route_type, agent_mode, model)
                    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
                    RETURNING *
                    """,
                    conversation_id,
                    message_id,
                    user_id,
                    rating,
                    reasons_json,
                    comment,
                    source,
                    route_type,
                    agent_mode,
                    model,
                )
            else:
                row = await self.conn.fetchrow(
                    f"""
                    UPDATE {self.table}
                    SET rating = $3,
                        reasons = $4::jsonb,
                        comment = $5,
                        source = $6,
                        route_type = $7,
                        agent_mode = $8,
                        model = $9,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE message_id = $1 AND user_id = $2
                    RETURNING *
                    """,
                    message_id,
                    user_id,
                    rating,
                    reasons_json,
                    comment,
                    source,
                    route_type,
                    agent_mode,
                    model,
                )
        return self._parse_row(row)

    async def clear(self, *, message_id: str, user_id: str) -> bool:
        """Удаляет оценку пользователя на сообщение. Идемпотентно.

        :returns: True, если строка была удалена; False, если её не было.
        """
        status = await self.conn.execute(
            f"DELETE FROM {self.table} WHERE message_id = $1 AND user_id = $2",
            message_id,
            user_id,
        )
        # asyncpg возвращает строку вида "DELETE <n>".
        try:
            return int(str(status).rsplit(" ", 1)[-1]) > 0
        except (ValueError, IndexError):
            return False

    async def get_for_message(
        self, *, message_id: str, user_id: str,
    ) -> dict | None:
        """Оценка конкретного пользователя на сообщение или None."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} "
            f"WHERE message_id = $1 AND user_id = $2",
            message_id,
            user_id,
        )
        return self._parse_row(row) if row else None

    async def get_map_for_conversation(
        self, *, conversation_id: str, user_id: str,
    ) -> dict[str, dict]:
        """Карта ``message_id -> оценка`` пользователя в рамках беседы.

        Используется для восстановления состояния кнопок при загрузке истории.
        """
        rows = await self.conn.fetch(
            f"SELECT * FROM {self.table} "
            f"WHERE conversation_id = $1 AND user_id = $2",
            conversation_id,
            user_id,
        )
        return {r["message_id"]: self._parse_row(r) for r in rows}
