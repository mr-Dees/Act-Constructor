"""
Репозиторий фактур актов.
"""

import json
import logging

import asyncpg

from app.core.exceptions import InvoiceError
from app.db.repositories.base import BaseRepository

logger = logging.getLogger("act_constructor.db.repository.invoice")


class ActInvoiceRepository(BaseRepository):
    """Работа с фактурами актов: справочники, CRUD, верификация."""

    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.invoices = self.adapter.get_table_name("act_invoices")

    async def list_metric_dict(self) -> list[dict]:
        """
        Возвращает справочник метрик из таблицы t_db_oarb_ua_violation_metric_dict.

        Returns:
            Список словарей {code, metric_name, metric_group}
        """
        from app.core.config import get_settings
        settings = get_settings()

        if settings.db_type == "postgresql":
            registry_schema = "public"
        else:
            registry_schema = settings.invoice_hive_registry_schema

        metric_table = settings.invoice_metric_dict_table

        rows = await self.conn.fetch(
            f'SELECT code, metric_name, metric_group '
            f'FROM {registry_schema}.{metric_table} '
            f'ORDER BY code',
        )

        return [
            {
                "code": row["code"],
                "metric_name": row["metric_name"],
                "metric_group": row["metric_group"],
            }
            for row in rows
        ]

    async def list_tables(self, db_type: str) -> list[dict]:
        """
        Возвращает полный список таблиц в указанной БД.

        Args:
            db_type: Тип БД (hive, greenplum)

        Returns:
            Список словарей {table_name}

        Raises:
            InvoiceError: Если db_type не поддерживается
        """
        from app.core.config import get_settings
        settings = get_settings()

        if db_type == "hive":
            if settings.db_type == "postgresql":
                registry_schema = "public"
            else:
                registry_schema = settings.invoice_hive_registry_schema

            registry_table = settings.invoice_hive_registry_table
            col_table = settings.invoice_hive_registry_col_table

            rows = await self.conn.fetch(
                f'SELECT {col_table} '
                f'FROM {registry_schema}.{registry_table} '
                f'ORDER BY {col_table}',
            )
            return [
                {"table_name": row[col_table]}
                for row in rows
            ]

        elif db_type == "greenplum":
            if settings.db_type == "postgresql":
                target_schema = "public"
            else:
                target_schema = settings.invoice_gp_schema

            rows = await self.conn.fetch(
                "SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename",
                target_schema,
            )
            return [
                {"table_name": row["tablename"]}
                for row in rows
            ]

        else:
            raise InvoiceError(f"Неподдерживаемый тип БД: {db_type}")

    async def save_invoice(self, data: dict, username: str) -> dict:
        """
        Сохраняет фактуру (UPSERT по act_id + node_id).

        Args:
            data: Словарь с данными фактуры
            username: Имя пользователя

        Returns:
            Словарь с данными сохраненной фактуры
        """
        row = await self.adapter.upsert_invoice(
            self.conn, self.invoices, data, username
        )

        logger.info(
            f"Фактура сохранена: act_id={data['act_id']}, "
            f"node_id={data['node_id']}, table={data['table_name']}"
        )

        metrics = row["metrics"]
        if isinstance(metrics, str):
            metrics = json.loads(metrics)

        return {
            "id": row["id"],
            "act_id": row["act_id"],
            "node_id": row["node_id"],
            "node_number": row["node_number"],
            "db_type": row["db_type"],
            "schema_name": row["schema_name"],
            "table_name": row["table_name"],
            "metrics": metrics,
            "verification_status": row["verification_status"],
            "created_at": row["created_at"].isoformat(),
            "updated_at": row["updated_at"].isoformat(),
            "created_by": row["created_by"],
        }

    async def get_invoice_for_node(
            self,
            act_id: int,
            node_id: str,
    ) -> dict | None:
        """Получает фактуру для конкретного узла."""
        row = await self.conn.fetchrow(
            f"""
            SELECT id, act_id, node_id, node_number, db_type,
                   schema_name, table_name, metrics,
                   verification_status, created_at, updated_at, created_by
            FROM {self.invoices}
            WHERE act_id = $1 AND node_id = $2
            """,
            act_id,
            node_id,
        )

        if not row:
            return None

        metrics = row["metrics"]
        if isinstance(metrics, str):
            metrics = json.loads(metrics)

        return {
            "id": row["id"],
            "act_id": row["act_id"],
            "node_id": row["node_id"],
            "node_number": row["node_number"],
            "db_type": row["db_type"],
            "schema_name": row["schema_name"],
            "table_name": row["table_name"],
            "metrics": metrics,
            "verification_status": row["verification_status"],
            "created_at": row["created_at"].isoformat(),
            "updated_at": row["updated_at"].isoformat(),
            "created_by": row["created_by"],
        }

    async def get_invoices_for_act(self, act_id: int) -> list[dict]:
        """Получает все фактуры для акта."""
        rows = await self.conn.fetch(
            f"""
            SELECT id, act_id, node_id, node_number, db_type,
                   schema_name, table_name, metrics,
                   verification_status, created_at, updated_at, created_by
            FROM {self.invoices}
            WHERE act_id = $1
            ORDER BY node_number, created_at
            """,
            act_id,
        )

        result = []
        for row in rows:
            metrics = row["metrics"]
            if isinstance(metrics, str):
                metrics = json.loads(metrics)

            result.append({
                "id": row["id"],
                "act_id": row["act_id"],
                "node_id": row["node_id"],
                "node_number": row["node_number"],
                "db_type": row["db_type"],
                "schema_name": row["schema_name"],
                "table_name": row["table_name"],
                "metrics": metrics,
                "verification_status": row["verification_status"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "created_by": row["created_by"],
            })

        return result

    async def verify_invoice(self, invoice_id: int) -> dict:
        """
        Верификация фактуры (TODO-заглушка).

        В будущем здесь будет вызов внешнего сервиса для проверки
        соответствия фактуры и данных в таблице.
        """
        logger.info(f"TODO: Верификация фактуры ID={invoice_id} (заглушка)")
        return {
            "invoice_id": invoice_id,
            "status": "pending",
            "message": "Верификация пока не реализована",
        }
