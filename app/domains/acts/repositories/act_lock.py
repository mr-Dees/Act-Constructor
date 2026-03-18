"""
Репозиторий блокировок актов.

Атомарные SQL-операции без бизнес-логики. Вся логика принятия решений —
в сервисном слое. Все временные сравнения используют CURRENT_TIMESTAMP (серверное время).
"""

import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("act_constructor.db.repository.lock")


class ActLockRepository(BaseRepository):
    """Атомарные операции блокировок актов."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.acts = self.adapter.get_table_name("acts")

    async def atomic_lock_act(
        self,
        act_id: int,
        username: str,
        duration_minutes: int,
    ) -> dict | None:
        """
        Атомарно захватывает блокировку.

        UPDATE ... WHERE (свободна OR моя OR истекла) RETURNING *
        Использует CURRENT_TIMESTAMP для серверного времени.

        Returns:
            dict с locked_by/locked_at/lock_expires_at или None если не удалось
        """
        row = await self.conn.fetchrow(
            f"""
            UPDATE {self.acts}
            SET locked_by = $1,
                locked_at = CURRENT_TIMESTAMP,
                lock_expires_at = CURRENT_TIMESTAMP + $2 * interval '1 minute'
            WHERE id = $3
              AND (locked_by IS NULL OR locked_by = $1 OR lock_expires_at <= CURRENT_TIMESTAMP)
            RETURNING locked_by, locked_at, lock_expires_at
            """,
            username,
            float(duration_minutes),
            act_id,
        )
        if row:
            logger.info(
                f"Акт ID={act_id} заблокирован пользователем {username} "
                f"на {duration_minutes} мин"
            )
            return dict(row)
        return None

    async def atomic_extend_lock(
        self,
        act_id: int,
        username: str,
        duration_minutes: int,
    ) -> dict:
        """
        Атомарно продлевает блокировку.

        Возвращает результат попытки И текущее состояние в одном запросе (без TOCTOU).

        Returns:
            dict с полями: extended (bool), locked_by, lock_expires_at
        """
        row = await self.conn.fetchrow(
            f"""
            WITH attempt AS (
                UPDATE {self.acts}
                SET lock_expires_at = CURRENT_TIMESTAMP + $1 * interval '1 minute'
                WHERE id = $2
                  AND locked_by = $3
                  AND lock_expires_at > CURRENT_TIMESTAMP
                RETURNING locked_by, locked_at, lock_expires_at
            )
            SELECT
                a.locked_by,
                a.lock_expires_at,
                EXISTS(SELECT 1 FROM attempt) AS extended,
                (SELECT lock_expires_at FROM attempt) AS new_lock_expires_at
            FROM {self.acts} a
            WHERE a.id = $2
            """,
            float(duration_minutes),
            act_id,
            username,
        )
        if not row:
            return {"extended": False, "locked_by": None, "lock_expires_at": None}

        result = {
            "extended": row["extended"],
            "locked_by": row["locked_by"],
            "lock_expires_at": row["new_lock_expires_at"] if row["extended"] else row["lock_expires_at"],
        }

        if row["extended"]:
            logger.info(f"Блокировка акта ID={act_id} продлена на {duration_minutes} мин")

        return result

    async def get_lock_info(self, act_id: int) -> dict | None:
        """SELECT locked_by, lock_expires_at для диагностики."""
        row = await self.conn.fetchrow(
            f"""
            SELECT locked_by, lock_expires_at
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id,
        )
        return dict(row) if row else None

    async def unlock_act(self, act_id: int, username: str) -> bool:
        """
        Снимает блокировку с акта.

        Returns:
            True если блокировка была снята, False если пользователь не владеет блокировкой.
        """
        result = await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET locked_by = NULL,
                locked_at = NULL,
                lock_expires_at = NULL
            WHERE id = $1 AND locked_by = $2
            """,
            act_id,
            username,
        )

        if result == "UPDATE 0":
            logger.warning(
                f"Попытка снять блокировку с акта ID={act_id} "
                f"пользователем {username}, который не владеет блокировкой"
            )
            return False

        logger.info(f"Блокировка снята с акта ID={act_id} пользователем {username}")
        return True
