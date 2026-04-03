"""
Репозиторий аудит-лога администрирования.

Записывает операции с ролями для отслеживания действий администраторов.
"""

import logging
from datetime import date, datetime

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.db.repository.admin_audit_log")


class AdminAuditLogRepository(BaseRepository):
    """Запись и чтение аудит-лога администрирования."""

    def __init__(self, conn):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("admin_audit_log")

    async def log(
        self,
        action: str,
        target_username: str,
        admin_username: str,
        role_id: int | None = None,
        role_name: str = "",
        details: str = "",
    ) -> None:
        """
        Записывает операцию в аудит-лог.

        Ошибка записи не блокирует основную операцию.
        """
        try:
            await self.conn.execute(
                f"""
                INSERT INTO {self.table}
                    (action, target_username, admin_username, role_id, role_name, details)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                action, target_username, admin_username, role_id, role_name, details,
            )
        except Exception:
            logger.exception(
                "Не удалось записать аудит-лог: action=%s, target=%s, admin=%s",
                action, target_username, admin_username,
            )

    async def get_log(
        self,
        *,
        action: str | None = None,
        target_username: str | None = None,
        admin_username: str | None = None,
        from_date: str | None = None,
        to_date: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Записи аудит-лога с фильтрацией и пагинацией."""
        where: list[str] = []
        params: list = []
        idx = 1

        if action:
            where.append(f"action = ${idx}")
            params.append(action)
            idx += 1
        if target_username:
            where.append(f"target_username = ${idx}")
            params.append(target_username)
            idx += 1
        if admin_username:
            where.append(f"admin_username = ${idx}")
            params.append(admin_username)
            idx += 1
        if from_date:
            where.append(f"created_at >= ${idx}")
            parsed = (
                datetime.fromisoformat(from_date)
                if "T" in from_date
                else datetime.combine(date.fromisoformat(from_date), datetime.min.time())
            )
            params.append(parsed)
            idx += 1
        if to_date:
            where.append(f"created_at <= ${idx}")
            parsed = (
                datetime.fromisoformat(to_date)
                if "T" in to_date
                else datetime.combine(
                    date.fromisoformat(to_date),
                    datetime.max.time().replace(microsecond=0),
                )
            )
            params.append(parsed)
            idx += 1

        where_clause = " WHERE " + " AND ".join(where) if where else ""

        total = await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.table}{where_clause}",
            *params,
        )

        params.extend([limit, offset])
        rows = await self.conn.fetch(
            f"""
            SELECT id, action, target_username, admin_username,
                   role_id, role_name, details, created_at
            FROM {self.table}{where_clause}
            ORDER BY created_at DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *params,
        )
        return [dict(r) for r in rows], total
