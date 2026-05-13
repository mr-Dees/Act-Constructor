"""Репозиторий очереди запросов к внешнему ИИ-агенту."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.agent_request")


class AgentRequestRepository(BaseRepository):
    """CRUD над таблицей agent_requests."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("agent_requests")

    @staticmethod
    def _parse_row(row: dict) -> dict:
        """Парсит JSONB-поля из строк в Python-объекты."""
        result = dict(row)
        for key in ("knowledge_bases", "history", "files"):
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
        message_id: str,
        user_id: str,
        last_user_message: str,
        domain_name: str | None = None,
        knowledge_bases: list[str] | None = None,
        history: list[dict] | None = None,
        files: list[dict] | None = None,
    ) -> None:
        """Создаёт запись запроса со статусом 'pending'."""
        await self.conn.execute(
            f"""
            INSERT INTO {self.table}
                (id, conversation_id, message_id, user_id, domain_name,
                 knowledge_bases, last_user_message, history, files)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb)
            """,
            id,
            conversation_id,
            message_id,
            user_id,
            domain_name,
            json.dumps(knowledge_bases or [], ensure_ascii=False),
            last_user_message,
            json.dumps(history or [], ensure_ascii=False),
            json.dumps(files or [], ensure_ascii=False),
        )
        logger.debug(
            "agent_requests: создан id=%s conv=%s status=pending",
            id, conversation_id,
        )

    async def get(self, request_id: str) -> dict | None:
        """Возвращает строку запроса по идентификатору, либо None."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} WHERE id = $1",
            request_id,
        )
        return self._parse_row(row) if row else None

    async def find_pending(self, older_than_sec: int) -> list[dict]:
        """Возвращает agent_requests со статусом pending/in_progress, созданные
        раньше now() - older_than_sec секунд. Используется lifespan-reconcile
        при старте приложения: дотягивает polling-задачи, оборванные прошлым
        процессом (например, после рестарта uvicorn).

        GP-совместимо: без CTE, без window functions, без ON CONFLICT;
        интервал собирается как `$1::int * interval '1 second'` — это
        работает и в PG 9.4, и в Greenplum 6.
        """
        rows = await self.conn.fetch(
            f"""
            SELECT * FROM {self.table}
            WHERE status IN ('pending', 'in_progress')
              AND created_at < now() - ($1::int * interval '1 second')
            ORDER BY created_at
            """,
            older_than_sec,
        )
        return [self._parse_row(r) for r in rows]

    async def update_status(
        self,
        request_id: str,
        *,
        status: str,
        error_message: str | None = None,
    ) -> None:
        """Обновляет статус запроса; для in_progress/done/error/timeout
        дополнительно проставляет временные метки."""
        if status == "in_progress":
            await self.conn.execute(
                f"UPDATE {self.table} SET status = $2, started_at = now() WHERE id = $1",
                request_id, status,
            )
        elif status in ("done", "error", "timeout"):
            await self.conn.execute(
                f"""UPDATE {self.table}
                    SET status = $2, error_message = $3, finished_at = now()
                    WHERE id = $1""",
                request_id, status, error_message,
            )
        else:
            await self.conn.execute(
                f"UPDATE {self.table} SET status = $2 WHERE id = $1",
                request_id, status,
            )
        logger.debug(
            "agent_requests: обновлён id=%s status=%s",
            request_id, status,
        )
