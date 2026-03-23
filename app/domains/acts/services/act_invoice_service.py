"""
Сервис фактур актов.

Справочники метрик, списки таблиц, CRUD и верификация фактур.
"""

import json
import logging

import asyncpg

from app.core.config import Settings
from app.domains.acts.exceptions import InvoiceError
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.repositories.act_invoice import ActInvoiceRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.services.access_guard import AccessGuard
from app.domains.acts.settings import ActsSettings

logger = logging.getLogger("act_constructor.service.acts.invoice")


class ActInvoiceService:
    """Справочники, CRUD и верификация фактур."""

    def __init__(
        self,
        conn: asyncpg.Connection,
        settings: Settings,
        *,
        acts_settings: ActsSettings,
        access: ActAccessRepository | None = None,
        lock: ActLockRepository | None = None,
        invoice: ActInvoiceRepository | None = None,
    ):
        self.conn = conn
        self.settings = settings
        self.acts_settings = acts_settings
        self._access = access or ActAccessRepository(conn)
        self._lock = lock or ActLockRepository(conn)
        self._invoice = invoice or ActInvoiceRepository(conn)
        self.guard = AccessGuard(self._access, self._lock)
        self._audit = ActAuditLogRepository(conn)

    def _resolve_schema(self, schema: str) -> str:
        """Возвращает 'public' для PostgreSQL, иначе — переданную схему."""
        if self.settings.database.type == "postgresql":
            return "public"
        return schema

    async def list_metrics(self) -> list[dict]:
        """Возвращает справочник метрик."""
        registry_schema = self._resolve_schema(
            self.acts_settings.invoice.hive_registry_schema
        )
        return await self._invoice.list_metric_dict(
            registry_schema=registry_schema,
            metric_table=self.acts_settings.invoice.metric_dict_table,
        )

    async def list_processes(self) -> list[dict]:
        """Возвращает справочник процессов."""
        inv = self.acts_settings.invoice
        registry_schema = self._resolve_schema(inv.hive_registry_schema)
        return await self._invoice.list_process_dict(
            registry_schema=registry_schema,
            process_table=inv.process_dict_table,
            col_code=inv.process_dict_col_code,
            col_name=inv.process_dict_col_name,
        )

    async def list_subsidiaries(self) -> list[dict]:
        """Возвращает справочник подразделений."""
        inv = self.acts_settings.invoice
        registry_schema = self._resolve_schema(inv.hive_registry_schema)
        return await self._invoice.list_subsidiary_dict(
            registry_schema=registry_schema,
            subsidiary_table=inv.subsidiary_dict_table,
            col_name=inv.subsidiary_dict_col_name,
        )

    async def list_tables(self, db_type: str) -> list[dict]:
        """Возвращает список таблиц в указанной БД."""
        inv = self.acts_settings.invoice

        if db_type == "hive":
            return await self._invoice.list_tables(
                db_type,
                hive_registry_schema=self._resolve_schema(inv.hive_registry_schema),
                hive_registry_table=inv.hive_registry_table,
                hive_registry_col_table=inv.hive_registry_col_table,
            )
        elif db_type == "greenplum":
            return await self._invoice.list_tables(
                db_type,
                gp_target_schema=self._resolve_schema(inv.gp_schema),
            )
        else:
            raise InvoiceError(f"Неподдерживаемый тип БД: {db_type}")

    async def save_invoice(self, data: dict, username: str) -> dict:
        """Сохраняет фактуру с детекцией реальных изменений для ETL-полей."""
        await self.guard.require_edit_permission(data["act_id"], username)

        current = await self._invoice.get_invoice_for_node(
            data["act_id"], data["node_id"]
        )

        if current and not self._has_real_changes(current, data):
            logger.info(
                f"Фактура не изменена: act_id={data['act_id']}, "
                f"node_id={data['node_id']}, пропуск UPDATE"
            )
            return current

        result = await self._invoice.save_invoice(data, username)
        logger.info(
            f"Фактура сохранена: act_id={data['act_id']}, "
            f"node_id={data['node_id']}, user={username}"
        )

        await self._audit.log("save_invoice", username, data["act_id"], {
            "node_id": data["node_id"],
            "db_type": data.get("db_type"),
            "table_name": data.get("table_name"),
            "metrics_count": len(data.get("metrics", [])),
        })

        return result

    @staticmethod
    def _has_real_changes(current: dict, new_data: dict) -> bool:
        """Сравнивает текущие и новые данные фактуры."""
        for field in ("db_type", "schema_name", "table_name", "profile_div"):
            if current.get(field) != new_data.get(field):
                return True

        current_metrics = current.get("metrics") or []
        new_metrics = new_data.get("metrics") or []
        if json.dumps(current_metrics, sort_keys=True, ensure_ascii=False) != \
           json.dumps(new_metrics, sort_keys=True, ensure_ascii=False):
            return True

        current_process = current.get("process") or []
        new_process = new_data.get("process") or []
        if json.dumps(current_process, sort_keys=True, ensure_ascii=False) != \
           json.dumps(new_process, sort_keys=True, ensure_ascii=False):
            return True

        return False

    async def verify_invoice(self, invoice_id: int, act_id: int, username: str) -> dict:
        """Верификация фактуры (заглушка)."""
        await self.guard.require_access(act_id, username)
        return await self._invoice.verify_invoice(invoice_id)

    async def get_invoices(self, act_id: int, username: str) -> list[dict]:
        """Получает список фактур акта."""
        await self.guard.require_access(act_id, username)
        return await self._invoice.get_invoices_for_act(act_id)
