"""
Репозиторий блокировок актов.
"""

import logging
from datetime import datetime, timedelta

import asyncpg

from app.core.exceptions import ActLockError
from app.db.repositories.base import BaseRepository

logger = logging.getLogger("act_constructor.db.repository.lock")


class ActLockRepository(BaseRepository):
    """Управление блокировками актов для эксклюзивного редактирования."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.acts = self.adapter.get_table_name("acts")

    async def lock_act(
            self,
            act_id: int,
            username: str,
            duration_minutes: int | None = None
    ) -> dict:
        """
        Блокирует акт для редактирования.

        Returns:
            dict с информацией о блокировке

        Raises:
            ValueError: если акт уже заблокирован другим пользователем
        """
        if duration_minutes is None:
            from app.core.config import get_settings
            settings = get_settings()
            duration_minutes = settings.act_lock_duration_minutes

        lock_info = await self.conn.fetchrow(
            f"""
            SELECT locked_by, locked_at, lock_expires_at
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id
        )

        now = datetime.now()

        if lock_info['locked_by']:
            if lock_info['locked_by'] == username:
                lock_expires = now + timedelta(minutes=duration_minutes)

                await self.conn.execute(
                    f"""
                    UPDATE {self.acts}
                    SET lock_expires_at = $1
                    WHERE id = $2 AND locked_by = $3
                    """,
                    lock_expires,
                    act_id,
                    username
                )

                logger.info(f"Блокировка акта ID={act_id} продлена для {username}")

                return {
                    "success": True,
                    "locked_until": lock_expires.isoformat(),
                    "message": "Блокировка продлена"
                }
            else:
                if lock_info['lock_expires_at'] and lock_info['lock_expires_at'] > now:
                    raise ActLockError(
                        f"Акт редактируется пользователем {lock_info['locked_by']}. "
                        f"Попробуйте открыть его позже.",
                        locked_by=lock_info["locked_by"],
                        locked_until=str(lock_info["lock_expires_at"]),
                    )

        lock_expires = now + timedelta(minutes=duration_minutes)

        result = await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET locked_by = $1,
                locked_at = $2,
                lock_expires_at = $3
            WHERE id = $4
              AND (locked_by IS NULL OR lock_expires_at <= $5)
            """,
            username,
            now,
            lock_expires,
            act_id,
            now
        )

        if result == "UPDATE 0":
            raise ActLockError(
                "Не удалось заблокировать акт — блокировка была захвачена другим пользователем. "
                "Попробуйте позже."
            )

        logger.info(f"Акт ID={act_id} заблокирован пользователем {username} до {lock_expires}")

        return {
            "success": True,
            "locked_until": lock_expires.isoformat(),
            "message": "Акт заблокирован для редактирования"
        }

    async def unlock_act(self, act_id: int, username: str) -> None:
        """Снимает блокировку с акта."""
        result = await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET locked_by = NULL,
                locked_at = NULL,
                lock_expires_at = NULL
            WHERE id = $1 AND locked_by = $2
            """,
            act_id,
            username
        )

        if result == "UPDATE 0":
            logger.warning(
                f"Попытка снять блокировку с акта ID={act_id} "
                f"пользователем {username}, который не владеет блокировкой"
            )
        else:
            logger.info(f"Блокировка снята с акта ID={act_id} пользователем {username}")

    async def extend_lock(
            self,
            act_id: int,
            username: str,
            duration_minutes: int | None = None
    ) -> dict:
        """
        Продлевает блокировку акта.

        Raises:
            ValueError: если пользователь не владеет блокировкой
        """
        if duration_minutes is None:
            from app.core.config import get_settings
            settings = get_settings()
            duration_minutes = settings.act_lock_duration_minutes

        lock_info = await self.conn.fetchrow(
            f"""
            SELECT locked_by, lock_expires_at
            FROM {self.acts}
            WHERE id = $1
            """,
            act_id
        )

        if not lock_info['locked_by']:
            raise ActLockError("Акт не заблокирован")

        if lock_info['locked_by'] != username:
            raise ActLockError("Вы не владеете блокировкой этого акта")

        if lock_info['lock_expires_at'] and lock_info['lock_expires_at'] <= datetime.now():
            raise ActLockError("Блокировка истекла. Откройте акт заново для продолжения работы.")

        lock_expires = datetime.now() + timedelta(minutes=duration_minutes)

        result = await self.conn.execute(
            f"""
            UPDATE {self.acts}
            SET lock_expires_at = $1
            WHERE id = $2 AND locked_by = $3
            """,
            lock_expires,
            act_id,
            username
        )

        if result == "UPDATE 0":
            raise ActLockError("Блокировка была перехвачена другим пользователем")

        logger.info(f"Блокировка акта ID={act_id} продлена до {lock_expires}")

        return {
            "success": True,
            "locked_until": lock_expires.isoformat(),
            "message": "Блокировка продлена"
        }
