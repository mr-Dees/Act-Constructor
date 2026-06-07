"""Репозиторий центра уведомлений."""

import asyncpg

from app.db.repositories.base import BaseRepository


class NotificationRepository(BaseRepository):
    """CRUD-операции с уведомлениями и состоянием их прочтения.

    Состояние (``notification_state``) создаётся лениво при первом
    read/dismiss. UPSERT через ``ON CONFLICT`` недоступен (GP = PG 9.4):
    делаем «UPDATE; если 0 строк — INSERT». Все UPDATE состояния явно
    ставят ``updated_at = CURRENT_TIMESTAMP`` (триггеров в проекте нет).
    """

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        # Стандартный домен: схему не указываем — PG public / основная схема GP.
        self.notifications = self.adapter.get_table_name("notifications")
        self.state = self.adapter.get_table_name("notification_state")

    async def list_for_user(self, user_id: str, *, limit: int = 50) -> list[dict]:
        """Возвращает видимые пользователю уведомления (адресные + broadcast).

        Исключает скрытые (``is_dismissed = TRUE``). ``is_read`` — COALESCE
        со state (нет строки → FALSE). Сортировка по дате создания DESC.
        """
        rows = await self.conn.fetch(
            f"""
            SELECT n.id, n.source, n.severity, n.title, n.body,
                   n.link, n.element_ref, n.created_at,
                   COALESCE(s.is_read, FALSE) AS is_read
            FROM {self.notifications} n
            LEFT JOIN {self.state} s
                ON s.notification_id = n.id AND s.user_id = $1
            WHERE (n.recipient_user_id = $1 OR n.recipient_user_id IS NULL)
              AND COALESCE(s.is_dismissed, FALSE) = FALSE
            ORDER BY n.created_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
        return [dict(r) for r in rows]

    async def unread_count(self, user_id: str) -> int:
        """Возвращает число непрочитанных видимых уведомлений пользователя.

        Непрочитанные = state нет ИЛИ is_read=FALSE, и при этом не скрытые.
        """
        count = await self.conn.fetchval(
            f"""
            SELECT COUNT(*)
            FROM {self.notifications} n
            LEFT JOIN {self.state} s
                ON s.notification_id = n.id AND s.user_id = $1
            WHERE (n.recipient_user_id = $1 OR n.recipient_user_id IS NULL)
              AND COALESCE(s.is_dismissed, FALSE) = FALSE
              AND COALESCE(s.is_read, FALSE) = FALSE
            """,
            user_id,
        )
        return count or 0

    async def mark_read(self, notification_id: str, user_id: str) -> None:
        """Помечает уведомление прочитанным (lazy upsert state)."""
        result = await self.conn.execute(
            f"""
            UPDATE {self.state}
            SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE notification_id = $1 AND user_id = $2
            """,
            notification_id,
            user_id,
        )
        if result == "UPDATE 0":
            await self.conn.execute(
                f"""
                INSERT INTO {self.state}
                    (notification_id, user_id, is_read, is_dismissed)
                VALUES ($1, $2, TRUE, FALSE)
                """,
                notification_id,
                user_id,
            )

    async def mark_all_read(self, user_id: str) -> None:
        """Помечает все видимые уведомления пользователя прочитанными.

        Для уведомлений без state — создаёт state с is_read=TRUE; для
        существующих (включая broadcast с уже созданным state) — UPDATE.
        Скрытые (is_dismissed) не трогаем.
        """
        # 1. Обновляем уже существующие непрочитанные state-строки.
        await self.conn.execute(
            f"""
            UPDATE {self.state}
            SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1 AND is_read = FALSE AND is_dismissed = FALSE
            """,
            user_id,
        )
        # 2. Создаём state для видимых уведомлений, у которых его ещё нет.
        await self.conn.execute(
            f"""
            INSERT INTO {self.state}
                (notification_id, user_id, is_read, is_dismissed)
            SELECT n.id, $1, TRUE, FALSE
            FROM {self.notifications} n
            WHERE (n.recipient_user_id = $1 OR n.recipient_user_id IS NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM {self.state} s
                  WHERE s.notification_id = n.id AND s.user_id = $1
              )
            """,
            user_id,
        )

    async def dismiss(self, notification_id: str, user_id: str) -> None:
        """Скрывает уведомление для пользователя (lazy upsert state)."""
        result = await self.conn.execute(
            f"""
            UPDATE {self.state}
            SET is_dismissed = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE notification_id = $1 AND user_id = $2
            """,
            notification_id,
            user_id,
        )
        if result == "UPDATE 0":
            await self.conn.execute(
                f"""
                INSERT INTO {self.state}
                    (notification_id, user_id, is_read, is_dismissed)
                VALUES ($1, $2, FALSE, TRUE)
                """,
                notification_id,
                user_id,
            )

    async def create(
        self,
        *,
        id: str,
        source: str,
        title: str,
        severity: str = "info",
        body: str | None = None,
        link: str | None = None,
        element_ref: str | None = None,
        recipient_user_id: str | None = None,
        created_by: str = "system",
    ) -> str:
        """Создаёт уведомление и возвращает его id."""
        return await self.conn.fetchval(
            f"""
            INSERT INTO {self.notifications}
                (id, recipient_user_id, source, severity, title, body,
                 link, element_ref, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
            """,
            id,
            recipient_user_id,
            source,
            severity,
            title,
            body,
            link,
            element_ref,
            created_by,
        )
