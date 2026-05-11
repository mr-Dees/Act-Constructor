"""Репозиторий финальных ответов от внешнего ИИ-агента."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.agent_response")


class AgentResponseRepository(BaseRepository):
    """Операции над таблицей agent_responses.

    Финальный ответ записывается агентом ровно один раз — это stop-сигнал
    для AW (UNIQUE (request_id) гарантирует это на уровне БД).
    """

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("agent_responses")

    @staticmethod
    def _parse_row(row: dict) -> dict:
        """Парсит JSONB-поля blocks и token_usage."""
        result = dict(row)
        for key in ("blocks", "token_usage"):
            val = result.get(key)
            if isinstance(val, str):
                try:
                    result[key] = json.loads(val)
                except json.JSONDecodeError:
                    result[key] = None
        return result

    async def insert(
        self,
        *,
        id: str,
        request_id: str,
        blocks: list[dict],
        finish_reason: str = "stop",
        token_usage: dict | None = None,
        model: str | None = None,
    ) -> None:
        """Создаёт финальный ответ. Повторный INSERT для того же request_id
        будет отвергнут UNIQUE-ограничением."""
        await self.conn.execute(
            f"""
            INSERT INTO {self.table}
                (id, request_id, blocks, finish_reason, token_usage, model)
            VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6)
            """,
            id,
            request_id,
            json.dumps(blocks, ensure_ascii=False),
            finish_reason,
            json.dumps(token_usage, ensure_ascii=False) if token_usage is not None else None,
            model,
        )

    async def get_by_request_id(self, request_id: str) -> dict | None:
        """Возвращает финальный ответ по request_id, либо None."""
        row = await self.conn.fetchrow(
            f"SELECT * FROM {self.table} WHERE request_id = $1",
            request_id,
        )
        return self._parse_row(row) if row else None
