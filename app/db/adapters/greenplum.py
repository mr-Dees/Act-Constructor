"""
Адаптер для Greenplum.

Реализует интерфейс DatabaseAdapter с учетом специфики MPP-архитектуры.
"""

import logging
import re
from pathlib import Path

import asyncpg

from app.db.adapters.base import DatabaseAdapter

logger = logging.getLogger("act_constructor.db.adapters.greenplum")


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

    async def create_tables(self, conn: asyncpg.Connection, schema_paths: list[Path] | None = None, substitutions: dict[str, str] | None = None) -> None:
        """
        Создает таблицы из списка schema.sql для Greenplum.

        Сначала проверяет существование основной таблицы.
        Если таблицы уже есть - пропускает создание.
        """
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
                    schema_sql = schema_sql.replace(placeholder, value)

            # Пропускаем файлы без реальных SQL-операторов
            if not re.sub(r'--[^\n]*', '', schema_sql).strip():
                logger.debug(f"Пустая схема (только комментарии): {schema_path}, пропускаем")
                continue

            try:
                await conn.execute(schema_sql)
                logger.info(f"Greenplum таблицы созданы: {schema_path.parent.parent.name}")
            except asyncpg.DuplicateTableError as e:
                logger.info(f"Некоторые таблицы Greenplum уже существуют: {e}")
            except asyncpg.DuplicateObjectError as e:
                logger.info(f"Некоторые объекты Greenplum уже существуют: {e}")
            except Exception as e:
                logger.error(f"Ошибка создания Greenplum схемы {schema_path}: {e}")
                raise

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
