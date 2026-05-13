"""Репозиторий append-only ленты событий от внешнего ИИ-агента."""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.domains.chat.repo.agent_event")


class AgentEventRepository(BaseRepository):
    """Операции над таблицей agent_response_events.

    Записи append-only: только INSERT (новые события) и SELECT (polling).
    """

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("agent_response_events")

    @staticmethod
    def _parse_row(row: dict) -> dict:
        """Парсит payload (JSONB) из строки в Python-объект, если нужно."""
        result = dict(row)
        payload = result.get("payload")
        if isinstance(payload, str):
            try:
                result["payload"] = json.loads(payload)
            except json.JSONDecodeError:
                result["payload"] = None
        return result

    async def append(
        self,
        request_id: str,
        *,
        seq: int,
        event_type: str,
        payload: dict,
    ) -> int:
        """Добавляет событие; возвращает id (auto-generated через sequence)."""
        new_id = await self.conn.fetchval(
            f"""
            INSERT INTO {self.table}
                (request_id, seq, event_type, payload)
            VALUES ($1, $2, $3, $4::jsonb)
            RETURNING id
            """,
            request_id,
            seq,
            event_type,
            json.dumps(payload, ensure_ascii=False),
        )
        logger.debug(
            "agent_response_events: добавлено id=%s request=%s seq=%d тип=%s",
            new_id, request_id, seq, event_type,
        )
        return int(new_id)

    async def poll(
        self,
        request_id: str,
        *,
        since_seq: int | None,
    ) -> list[dict]:
        """Возвращает события запроса в порядке возрастания seq.

        Курсор по seq (а не по id): seq — монотонная нумерация в рамках
        одного request_id, контролируемая писателем (внешним агентом). id
        идёт из глобальной sequence, которая в Greenplum НЕ монотонна между
        сегментами distributed-таблицы — два события с consecutive seq могут
        получить id из разных сегментов в обратном порядке. Polling по id
        в GP может пропустить или переставить события; polling по seq —
        корректен и в PG, и в GP.
        """
        if since_seq is None:
            rows = await self.conn.fetch(
                f"""
                SELECT id, request_id, seq, event_type, payload, created_at
                FROM {self.table}
                WHERE request_id = $1
                ORDER BY seq
                """,
                request_id,
            )
        else:
            rows = await self.conn.fetch(
                f"""
                SELECT id, request_id, seq, event_type, payload, created_at
                FROM {self.table}
                WHERE request_id = $1 AND seq > $2
                ORDER BY seq
                """,
                request_id,
                since_seq,
            )
        if rows:
            logger.debug(
                "agent_response_events: получено %d событий после seq=%s "
                "для request=%s",
                len(rows), since_seq, request_id,
            )
        return [self._parse_row(r) for r in rows]
