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
        """Возвращает незавершённые agent_requests, созданные раньше
        now() - older_than_sec секунд. Используется lifespan-reconcile
        при старте приложения: дотягивает polling-задачи, оборванные
        прошлым процессом (например, после рестарта uvicorn).

        Стадии, которые считаются незавершёнными:
            pending     — INSERT от AW, раннер ещё не подхватил.
            dispatched  — раннер запустил polling, ждёт первого event агента.
            in_progress — внешний агент пишет события.

        GP-совместимо: без CTE, без window functions, без ON CONFLICT;
        интервал — `$1::int * interval '1 second'` (работает в PG 9.4 и GP 6).
        """
        rows = await self.conn.fetch(
            f"""
            SELECT * FROM {self.table}
            WHERE status IN ('pending', 'dispatched', 'in_progress')
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
        expected_version: int | None = None,
    ) -> int | None:
        """Обновляет статус запроса; для dispatched/in_progress/done/error/timeout
        дополнительно проставляет временные метки.

        started_at заполняется на первом переходе из 'pending' (через
        COALESCE сохраняется первая отметка), finished_at — на терминальных.

        Если передан ``expected_version`` — выполняется optimistic locking:
        в WHERE добавляется ``AND version = $expected_version``, и SQL
        возвращает новое значение version через RETURNING. При конфликте
        версии (никакая строка не была обновлена) возвращается ``None``.

        Без ``expected_version`` метод обновляет безусловно и возвращает новое
        значение version (или None, если строки с таким id не существует).
        В обоих режимах ``version`` инкрементируется на 1 при успешном UPDATE.
        """
        if status in ("dispatched", "in_progress"):
            set_clause = (
                "status = $2, "
                "started_at = COALESCE(started_at, now()), "
                "updated_at = now(), "
                "version = version + 1"
            )
            params: list = [request_id, status]
        elif status in ("done", "error", "timeout"):
            set_clause = (
                "status = $2, error_message = $3, finished_at = now(), "
                "updated_at = now(), version = version + 1"
            )
            params = [request_id, status, error_message]
        else:
            set_clause = (
                "status = $2, updated_at = now(), version = version + 1"
            )
            params = [request_id, status]

        if expected_version is None:
            sql = (
                f"UPDATE {self.table} SET {set_clause} "
                f"WHERE id = $1 RETURNING version"
            )
        else:
            params.append(expected_version)
            sql = (
                f"UPDATE {self.table} SET {set_clause} "
                f"WHERE id = $1 AND version = ${len(params)} "
                f"RETURNING version"
            )

        new_version = await self.conn.fetchval(sql, *params)
        if expected_version is not None and new_version is None:
            logger.warning(
                "agent_requests: version conflict id=%s status=%s "
                "expected_version=%s — апдейт пропущен",
                request_id, status, expected_version,
            )
        else:
            logger.debug(
                "agent_requests: обновлён id=%s status=%s version=%s",
                request_id, status, new_version,
            )
        return new_version

    async def claim_pending(
        self,
        worker_token: str,
        older_than_sec: int = 30,
    ) -> list[str]:
        """Атомарно «клеймит» свободные pending/dispatched запросы текущим
        воркером и возвращает их id.

        Семантика: WHERE worker_token IS NULL AND status IN
        ('pending','dispatched') AND updated_at < now() - interval.
        UPDATE...RETURNING id выполняется одним statement-ом, поэтому
        одновременные claim'ы из разных воркеров не вернут пересечений —
        каждой строке достанется ровно один worker_token (первый, кто
        успел в транзакции; остальные при той же WHERE-条件 уже не увидят
        её, потому что worker_token стал не-NULL).

        Возвращает list[str] заклеймленных id (может быть пустым).

        GP-совместимо: без CTE, без ON CONFLICT, интервал — `$2::int *
        interval '1 second'`.
        """
        rows = await self.conn.fetch(
            f"""
            UPDATE {self.table}
               SET worker_token = $1,
                   updated_at = now()
             WHERE worker_token IS NULL
               AND status IN ('pending', 'dispatched')
               AND updated_at < now() - ($2::int * interval '1 second')
            RETURNING id
            """,
            worker_token, older_than_sec,
        )
        ids = [r["id"] for r in rows]
        if ids:
            logger.info(
                "agent_requests: claim_pending worker=%s заклеймил %d "
                "запросов: %s",
                worker_token, len(ids), ids,
            )
        return ids
