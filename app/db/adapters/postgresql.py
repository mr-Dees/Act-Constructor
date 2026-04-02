"""
Адаптер для PostgreSQL.

Реализует интерфейс DatabaseAdapter для стандартного PostgreSQL.
"""

import logging
import re
from collections.abc import Callable
from pathlib import Path

import asyncpg

from app.db.adapters.base import DatabaseAdapter

logger = logging.getLogger("audit_workstation.db.adapters.postgresql")


class PostgreSQLAdapter(DatabaseAdapter):
    """Адаптер для работы с PostgreSQL."""

    async def _get_existing_tables(
        self,
        conn: asyncpg.Connection,
        expected_names: list[str],
    ) -> set[str]:
        """Проверяет существование таблиц в схеме public."""
        if not expected_names:
            return set()
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename = ANY($1::text[])",
            expected_names,
        )
        return {r['tablename'] for r in rows}

    async def create_tables(self, conn: asyncpg.Connection, schema_paths: list[Path] | None = None, substitutions: dict[str, str | Callable[[], str]] | None = None) -> None:
        """Создает таблицы из списка schema.sql для PostgreSQL с проверкой целостности."""
        if not schema_paths:
            return

        for schema_path in schema_paths:
            if not schema_path.exists():
                logger.warning(f"Схема не найдена: {schema_path}, пропускаем")
                continue

            schema_sql = schema_path.read_text(encoding='utf-8')

            # Подстановка плейсхолдеров справочных таблиц
            if substitutions:
                for placeholder, value in substitutions.items():
                    resolved = value() if callable(value) else value
                    schema_sql = schema_sql.replace(placeholder, resolved)

            # Пропускаем файлы без реальных SQL-операторов
            if not re.sub(r'--[^\n]*', '', schema_sql).strip():
                logger.debug(f"Пустая схема (только комментарии): {schema_path}, пропускаем")
                continue

            domain_name = schema_path.parent.parent.parent.name
            expected = self._extract_table_names_from_sql(schema_sql)

            if not expected:
                logger.debug(f"Нет CREATE TABLE в схеме: {schema_path}")
                continue

            # Pre-check: какие таблицы уже существуют
            existing = await self._get_existing_tables(conn, expected)
            missing = [t for t in expected if t not in existing]

            if not missing:
                logger.info(
                    f"PostgreSQL: все таблицы домена '{domain_name}' существуют "
                    f"({len(expected)} шт.)"
                )
                continue

            logger.info(
                f"PostgreSQL: создание таблиц домена '{domain_name}' — "
                f"отсутствуют {len(missing)} из {len(expected)}: {', '.join(missing)}"
            )

            try:
                await conn.execute(schema_sql)
                logger.info(f"PostgreSQL схема выполнена: {domain_name}")
            except asyncpg.DuplicateObjectError:
                logger.info(f"PostgreSQL: некоторые объекты уже существуют ({domain_name})")
            except Exception as e:
                logger.error(f"Ошибка создания PostgreSQL схемы {schema_path}: {e}")
                raise

            # Post-verify: убеждаемся, что все таблицы созданы
            existing_after = await self._get_existing_tables(conn, expected)
            still_missing = [t for t in expected if t not in existing_after]

            if still_missing:
                raise RuntimeError(
                    f"PostgreSQL: не удалось создать все таблицы домена '{domain_name}'. "
                    f"Отсутствуют: {', '.join(still_missing)}"
                )

            logger.info(
                f"PostgreSQL: целостность схемы '{domain_name}' подтверждена "
                f"({len(expected)} таблиц)"
            )

    def get_table_name(self, base_name: str) -> str:
        """Возвращает имя таблицы без префиксов."""
        return base_name

    def qualify_table_name(self, full_name: str, schema: str = "") -> str:
        """Квалифицирует схемой если указана, иначе возвращает как есть."""
        if schema:
            return f"{schema}.{full_name}"
        return full_name

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
