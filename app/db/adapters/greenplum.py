"""
Адаптер для Greenplum.

Реализует интерфейс DatabaseAdapter с учетом специфики MPP-архитектуры.
"""

import logging
import re
from collections.abc import Callable
from pathlib import Path

import asyncpg

from app.db.adapters.base import DatabaseAdapter

logger = logging.getLogger("audit_workstation.db.adapters.greenplum")


class GreenplumAdapter(DatabaseAdapter):
    """Адаптер для работы с Greenplum."""

    def __init__(self, schema: str, table_prefix: str):
        """
        Инициализирует Greenplum адаптер.

        Args:
            schema: Схема для таблиц (s_grnplm_ld_audit_da_project_4)
            table_prefix: Префикс таблиц (t_db_oarb_audit_act_)
        """
        self.schema = schema
        self.table_prefix = table_prefix
        logger.info(
            f"Greenplum адаптер инициализирован: "
            f"schema={schema}, prefix={table_prefix}"
        )

    async def _get_existing_tables(
        self,
        conn: asyncpg.Connection,
        expected_names: list[str],
    ) -> set[str]:
        """Проверяет существование таблиц в схеме Greenplum."""
        if not expected_names:
            return set()

        # expected_names могут быть квалифицированными: schema.table_name
        name_map: dict[str, str] = {}
        for name in expected_names:
            parts = name.split('.')
            simple_name = parts[-1] if len(parts) > 1 else name
            name_map[simple_name] = name

        simple_names = list(name_map.keys())
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = $1 AND tablename = ANY($2::text[])",
            self.schema, simple_names,
        )
        existing_simple = {r['tablename'] for r in rows}
        return {name_map[s] for s in existing_simple if s in name_map}

    async def create_tables(self, conn: asyncpg.Connection, schema_paths: list[Path] | None = None, substitutions: dict[str, str | Callable[[], str]] | None = None) -> None:
        """Создает таблицы из списка schema.sql для Greenplum с проверкой целостности."""
        if not schema_paths:
            return

        for schema_path in schema_paths:
            if not schema_path.exists():
                logger.warning(f"Схема не найдена: {schema_path}, пропускаем")
                continue

            schema_sql = schema_path.read_text(encoding='utf-8')

            # Подставляем схему и префикс
            schema_sql = schema_sql.replace("{SCHEMA}", self.schema)
            schema_sql = schema_sql.replace("{PREFIX}", self.table_prefix)

            # Подстановка плейсхолдеров справочных таблиц
            if substitutions:
                for placeholder, value in substitutions.items():
                    resolved = value() if callable(value) else value
                    schema_sql = schema_sql.replace(placeholder, resolved)

            # Пропускаем файлы без реальных SQL-операторов
            if not re.sub(r'--[^\n]*', '', schema_sql).strip():
                logger.debug(f"Пустая схема (только комментарии): {schema_path}, пропускаем")
                continue

            domain_name = schema_path.parent.parent.name
            expected = self._extract_table_names_from_sql(schema_sql)

            if not expected:
                logger.debug(f"Нет CREATE TABLE в схеме: {schema_path}")
                continue

            # Pre-check: какие таблицы уже существуют
            existing = await self._get_existing_tables(conn, expected)
            missing = [t for t in expected if t not in existing]

            if not missing:
                logger.info(
                    f"Greenplum: все таблицы домена '{domain_name}' существуют "
                    f"({len(expected)} шт.)"
                )
                continue

            missing_short = [t.split('.')[-1] for t in missing]
            logger.info(
                f"Greenplum: создание таблиц домена '{domain_name}' — "
                f"отсутствуют {len(missing)} из {len(expected)}: {', '.join(missing_short)}"
            )

            try:
                await conn.execute(schema_sql)
                logger.info(f"Greenplum схема выполнена: {domain_name}")
            except asyncpg.DuplicateTableError as e:
                logger.warning(f"Greenplum: часть таблиц уже существовала ({domain_name}): {e}")
            except asyncpg.DuplicateObjectError as e:
                logger.warning(f"Greenplum: часть объектов уже существовала ({domain_name}): {e}")
            except Exception as e:
                logger.error(f"Ошибка создания Greenplum схемы {schema_path}: {e}")
                raise

            # Post-verify: убеждаемся, что все таблицы созданы
            existing_after = await self._get_existing_tables(conn, expected)
            still_missing = [t for t in expected if t not in existing_after]

            if still_missing:
                still_missing_short = [t.split('.')[-1] for t in still_missing]
                raise RuntimeError(
                    f"Greenplum: не удалось создать все таблицы домена '{domain_name}'. "
                    f"Отсутствуют: {', '.join(still_missing_short)}"
                )

            logger.info(
                f"Greenplum: целостность схемы '{domain_name}' подтверждена "
                f"({len(expected)} таблиц)"
            )

    def get_table_name(self, base_name: str) -> str:
        """
        Возвращает полное имя таблицы с схемой и префиксом.

        Пример: s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_acts
        """
        return f"{self.schema}.{self.table_prefix}{base_name}"

    def get_serial_type(self) -> str:
        """Greenplum использует BIGSERIAL."""
        return "BIGSERIAL"

    def get_index_strategy(self, index_type: str) -> str:
        """
        Greenplum имеет ограничения на индексы.

        GIN индексы могут быть медленными, используем BTREE где возможно.
        """
        if index_type.upper() == "GIN":
            logger.warning(
                "GIN индекс в Greenplum может быть медленным, "
                "рассмотрите альтернативы"
            )
            return "BTREE"
        return index_type

    def supports_cascade_delete(self) -> bool:
        """Greenplum НЕ поддерживает ON DELETE CASCADE."""
        return False

    def supports_on_conflict(self) -> bool:
        """Greenplum НЕ поддерживает INSERT ... ON CONFLICT DO UPDATE."""
        return False

    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """Возвращает настроенную схему Greenplum."""
        return self.schema
