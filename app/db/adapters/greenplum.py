"""
Адаптер для Greenplum.

Реализует интерфейс DatabaseAdapter с учетом специфики MPP-архитектуры.
"""

import logging
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

    async def create_tables(self, conn: asyncpg.Connection) -> None:
        """
        Создает таблицы из schema.sql для Greenplum.

        Сначала проверяет существование основной таблицы.
        Если таблицы уже есть - пропускает создание.
        """
        # Проверяем существование основной таблицы
        table_exists = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 
                FROM pg_tables 
                WHERE schemaname = $1 
                AND tablename = $2
            )
            """,
            self.schema,
            f"{self.table_prefix}acts"
        )

        if table_exists:
            logger.info(
                f"Таблицы в {self.schema}.{self.table_prefix}* уже существуют, "
                f"пропускаем создание"
            )
            return

        # Таблиц нет - создаем
        schema_path = (
                Path(__file__).parent.parent
                / "migrations"
                / "greenplum"
                / "schema.sql"
        )

        if not schema_path.exists():
            raise FileNotFoundError(f"Схема не найдена: {schema_path}")

        schema_sql = schema_path.read_text(encoding='utf-8')

        # Подставляем схему и префикс
        schema_sql = schema_sql.replace("{SCHEMA}", self.schema)
        schema_sql = schema_sql.replace("{PREFIX}", self.table_prefix)

        try:
            await conn.execute(schema_sql)
            logger.info("Greenplum таблицы созданы успешно")
        except asyncpg.DuplicateTableError as e:
            logger.info(f"Некоторые таблицы Greenplum уже существуют: {e}")
        except asyncpg.DuplicateObjectError as e:
            logger.info(f"Некоторые объекты Greenplum уже существуют: {e}")
        except Exception as e:
            logger.error(f"Ошибка создания Greenplum схемы: {e}")
            raise

    async def delete_act_cascade(
            self,
            conn: asyncpg.Connection,
            act_id: int
    ) -> None:
        """
        Удаляет акт с явным удалением связанных записей.

        Greenplum не поддерживает ON DELETE CASCADE,
        поэтому удаляем в правильном порядке.
        """
        async with conn.transaction():
            # Порядок важен: сначала зависимые таблицы
            tables_to_delete = [
                "act_invoices",
                "act_violations",
                "act_textblocks",
                "act_tables",
                "act_tree",
                "act_directives",
                "audit_team_members",
            ]

            for table in tables_to_delete:
                table_name = self.get_table_name(table)
                result = await conn.execute(
                    f"DELETE FROM {table_name} WHERE act_id = $1",
                    act_id
                )
                logger.debug(f"Удалено из {table}: {result}")

            # Финальное удаление акта
            acts_table = self.get_table_name("acts")
            await conn.execute(
                f"DELETE FROM {acts_table} WHERE id = $1",
                act_id
            )
            logger.debug(f"Акт ID={act_id} удален (Greenplum explicit cascade)")

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
            return "GIN"
        return index_type

    def supports_cascade_delete(self) -> bool:
        """Greenplum НЕ поддерживает ON DELETE CASCADE."""
        return False

    async def get_current_schema(self, conn: asyncpg.Connection) -> str:
        """Возвращает настроенную схему Greenplum."""
        return self.schema

    def get_distributed_by_clause(self, table_name: str) -> str:
        """
        Возвращает DISTRIBUTED BY clause для оптимального распределения.

        Стратегия распределения:
        - Все таблицы распределяются по id для избежания проблем с UPDATE
          на колонках в DISTRIBUTED BY при наличии триггеров
        """
        return "DISTRIBUTED BY (id)"
