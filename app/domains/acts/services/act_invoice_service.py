"""
Сервис фактур актов.

Справочники метрик, списки таблиц, CRUD и верификация фактур.
"""

import logging

import asyncpg

from app.core.config import Settings
from app.domains.acts.exceptions import InvoiceError
from app.domains.acts.repositories.act_access import ActAccessRepository
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
        """Сохраняет фактуру (UPSERT по act_id + node_id)."""
        await self.guard.require_edit_permission(data["act_id"], username)
        result = await self._invoice.save_invoice(data, username)
        logger.info(
            f"Фактура сохранена: act_id={data['act_id']}, "
            f"node_id={data['node_id']}, user={username}"
        )
        return result

    async def verify_invoice(self, invoice_id: int, act_id: int, username: str) -> dict:
        """Верификация фактуры (заглушка)."""
        await self.guard.require_access(act_id, username)
        return await self._invoice.verify_invoice(invoice_id)

    async def get_invoices(self, act_id: int, username: str) -> list[dict]:
        """Получает список фактур акта."""
        await self.guard.require_access(act_id, username)
        return await self._invoice.get_invoices_for_act(act_id)
