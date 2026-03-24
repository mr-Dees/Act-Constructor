"""
Репозиторий версий содержимого актов.

Создаёт снэпшоты содержимого при manual/periodic сохранении
для просмотра истории и восстановления.
"""

import json
import logging

import asyncpg

from app.db.repositories.base import BaseRepository

logger = logging.getLogger("audit_workstation.db.repository.content_version")


class ActContentVersionRepository(BaseRepository):
    """Версионирование содержимого актов."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.versions_table = self.adapter.get_table_name("act_content_versions")

    async def create_version(
        self,
        act_id: int,
        username: str,
        save_type: str,
        tree: dict,
        tables: dict,
        textblocks: dict,
        violations: dict,
        max_versions: int = 50,
    ) -> int | None:
        """
        Создаёт новый снэпшот. Возвращает version_number.

        Args:
            act_id: ID акта
            username: Пользователь
            save_type: Тип сохранения (manual, periodic)
            tree: Данные дерева
            tables: Данные таблиц
            textblocks: Данные текстовых блоков
            violations: Данные нарушений
            max_versions: Максимальное число версий (старые удаляются)
        """
        try:
            tree_json = json.dumps(tree, ensure_ascii=False, default=str)
            tables_json = json.dumps(tables, ensure_ascii=False, default=str)
            textblocks_json = json.dumps(textblocks, ensure_ascii=False, default=str)
            violations_json = json.dumps(violations, ensure_ascii=False, default=str)

            # Атомарный INSERT с вычислением version_number
            row = await self.conn.fetchrow(
                f"""
                INSERT INTO {self.versions_table}
                    (act_id, version_number, save_type, username,
                     tree_data, tables_data, textblocks_data, violations_data)
                SELECT $1, COALESCE(MAX(version_number), 0) + 1, $2, $3,
                       $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb
                FROM {self.versions_table}
                WHERE act_id = $1
                RETURNING version_number
                """,
                act_id,
                save_type,
                username,
                tree_json,
                tables_json,
                textblocks_json,
                violations_json,
            )
            next_version = row["version_number"]

            # Удалить старые версии если превышен лимит
            await self._cleanup_old_versions(act_id, max_versions)

            logger.info(
                f"Создана версия #{next_version} акта ID={act_id} "
                f"(save_type={save_type}, user={username})"
            )
            return next_version

        except Exception:
            logger.exception(
                f"Не удалось создать версию содержимого: "
                f"act_id={act_id}, username={username}"
            )
            return None

    async def get_versions_list(
        self, act_id: int, *, limit: int = 50, offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Список версий (без данных содержимого)."""
        count_row = await self.conn.fetchrow(
            f"SELECT COUNT(*) AS cnt FROM {self.versions_table} WHERE act_id = $1",
            act_id,
        )
        total = count_row["cnt"]

        rows = await self.conn.fetch(
            f"""
            SELECT id, version_number, save_type, username, created_at
            FROM {self.versions_table}
            WHERE act_id = $1
            ORDER BY version_number DESC
            LIMIT $2 OFFSET $3
            """,
            act_id,
            limit,
            offset,
        )
        items = [dict(r) for r in rows]
        return items, total

    async def get_version(self, act_id: int, version_id: int) -> dict | None:
        """Полный снэпшот конкретной версии для просмотра/восстановления."""
        row = await self.conn.fetchrow(
            f"""
            SELECT id, version_number, save_type, username,
                   tree_data, tables_data, textblocks_data, violations_data,
                   created_at
            FROM {self.versions_table}
            WHERE act_id = $1 AND id = $2
            """,
            act_id,
            version_id,
        )
        if not row:
            return None

        result = dict(row)
        # Конвертируем JSONB-строки в dict при необходимости
        for key in ("tree_data", "tables_data", "textblocks_data", "violations_data"):
            val = result.get(key)
            if isinstance(val, str):
                result[key] = json.loads(val)
        return result

    async def _cleanup_old_versions(self, act_id: int, max_versions: int) -> int:
        """Удаляет старые версии, оставляя последние max_versions."""
        result = await self.conn.execute(
            f"""
            DELETE FROM {self.versions_table}
            WHERE act_id = $1
              AND id NOT IN (
                  SELECT id FROM {self.versions_table}
                  WHERE act_id = $1
                  ORDER BY version_number DESC
                  LIMIT $2
              )
            """,
            act_id,
            max_versions,
        )
        # result: "DELETE N"
        deleted = int(result.split()[-1]) if result else 0
        if deleted > 0:
            logger.info(f"Удалено {deleted} старых версий акта ID={act_id}")
        return deleted
