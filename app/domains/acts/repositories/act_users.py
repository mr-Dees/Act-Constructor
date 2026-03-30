"""Репозиторий поиска пользователей в справочнике."""

from app.db.adapters.greenplum import GreenplumAdapter
from app.db.repositories.base import BaseRepository
from app.core.settings_registry import get as get_domain_settings
from app.domains.admin.settings import AdminSettings


class ActUsersRepository(BaseRepository):
    """Поиск пользователей в справочнике для формирования аудиторской группы."""

    def __init__(self, conn):
        super().__init__(conn)
        settings = get_domain_settings("admin", AdminSettings)
        ud = settings.user_directory
        if isinstance(self.adapter, GreenplumAdapter):
            self.user_table = f"{ud.schema_name}.{ud.table}"
        else:
            self.user_table = ud.table

    async def search_users(self, query: str, limit: int = 20) -> list[dict]:
        """Поиск по ФИО (ILIKE) или логину (LIKE)."""
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        rows = await self.conn.fetch(
            f"""
            SELECT username, fullname, job FROM (
                SELECT DISTINCT ON (username)
                       username,
                       COALESCE(fullname, '') AS fullname,
                       COALESCE(job, '') AS job
                FROM {self.user_table}
                WHERE fullname ILIKE $1 OR username LIKE $2
                ORDER BY username
            ) sub
            ORDER BY fullname
            LIMIT $3
            """,
            pattern,
            pattern,
            limit,
        )
        return [dict(r) for r in rows]
