"""
Адаптер для PostgreSQL.

Реализует интерфейс DatabaseAdapter для стандартного PostgreSQL.
"""

import logging
import re
from pathlib import Path

import asyncpg

from app.db.adapters.base import DatabaseAdapter

logger = logging.getLogger("act_constructor.db.adapters.postgresql")


class PostgreSQLAdapter(DatabaseAdapter):
    """Адаптер для работы с PostgreSQL."""

    async def create_tables(self, conn: asyncpg.Connection, schema_paths: list[Path] | None = None) -> None:
        """Создает таблицы из списка schema.sql для PostgreSQL."""
        if not schema_paths:
            return

        for schema_path in schema_paths:
            if not schema_path.exists():
                logger.warning(f"Схема не найдена: {schema_path}, пропускаем")
                continue

            schema_sql = schema_path.read_text(encoding='utf-8')

            # Пропускаем файлы без реальных SQL-операторов
            if not re.sub(r'--[^\n]*', '', schema_sql).strip():
                logger.debug(f"Пустая схема (только комментарии): {schema_path}, пропускаем")
                continue

            try:
                await conn.execute(schema_sql)
                logger.info(f"PostgreSQL схема создана: {schema_path.parent.parent.name}")
            except asyncpg.DuplicateObjectError:
                logger.info(f"PostgreSQL схема уже существует: {schema_path.parent.parent.name}")
            except Exception as e:
                logger.error(f"Ошибка создания PostgreSQL схемы {schema_path}: {e}")
                raise

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

    def supports_on_conflict(self) -> bool:
        """PostgreSQL поддерживает INSERT ... ON CONFLICT DO UPDATE."""
        return True

    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """Возвращает текущую схему PostgreSQL."""
        schema = await conn.fetchval("SELECT current_schema()")
        return schema or "public"
