"""
Адаптер для PostgreSQL.

Реализует интерфейс DatabaseAdapter для стандартного PostgreSQL.
"""

import logging
from pathlib import Path

import asyncpg

from app.db.adapters.base import DatabaseAdapter

logger = logging.getLogger("act_constructor.db.adapters.postgresql")


class PostgreSQLAdapter(DatabaseAdapter):
    """Адаптер для работы с PostgreSQL."""

    async def create_tables(self, conn: asyncpg.Connection) -> None:
        """Создает таблицы из schema.sql для PostgreSQL."""
        schema_path = (
                Path(__file__).parent.parent
                / "migrations"
                / "postgresql"
                / "schema.sql"
        )

        if not schema_path.exists():
            raise FileNotFoundError(f"Схема не найдена: {schema_path}")

        schema_sql = schema_path.read_text(encoding='utf-8')

        try:
            await conn.execute(schema_sql)
            logger.info("PostgreSQL схема создана успешно")
        except asyncpg.DuplicateObjectError:
            logger.info("PostgreSQL схема уже существует")
        except Exception as e:
            logger.error(f"Ошибка создания PostgreSQL схемы: {e}")
            raise

    async def delete_act_cascade(
            self,
            conn: asyncpg.Connection,
            act_id: int
    ) -> None:
        """
        Удаляет акт используя ON DELETE CASCADE.

        PostgreSQL автоматически удаляет связанные записи.
        """
        await conn.execute(
            "DELETE FROM acts WHERE id = $1",
            act_id
        )
        logger.debug(f"Акт ID={act_id} удален (PostgreSQL CASCADE)")

    def get_table_name(self, base_name: str) -> str:
        """Возвращает имя таблицы без префиксов."""
        return base_name

    def get_serial_type(self) -> str:
        """PostgreSQL использует SERIAL."""
        return "SERIAL"

    def get_index_strategy(self, index_type: str) -> str:
        """
        PostgreSQL поддерживает все типы индексов.

        GIN индексы на JSONB работают эффективно.
        """
        return index_type

    def supports_cascade_delete(self) -> bool:
        """PostgreSQL поддерживает ON DELETE CASCADE."""
        return True

    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """Возвращает текущую схему PostgreSQL."""
        schema = await conn.fetchval("SELECT current_schema()")
        return schema or "public"

    def get_distributed_by_clause(self, table_name: str) -> str:
        """PostgreSQL не использует DISTRIBUTED BY."""
        return ""
