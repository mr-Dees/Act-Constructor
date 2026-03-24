"""
Сервис содержимого актов.

Загрузка и сохранение содержимого: дерево, таблицы, текстблоки, нарушения.
"""

import logging

import asyncpg

from app.core.config import Settings
from app.domains.acts.exceptions import AccessDeniedError, ActValidationError
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.repositories.act_invoice import ActInvoiceRepository
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.repositories.act_content_version import ActContentVersionRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.services.access_guard import AccessGuard
from app.domains.acts.settings import ActsSettings
from app.domains.acts.utils import ActTreeUtils

logger = logging.getLogger("audit_workstation.service.acts.content")


class ActContentService:
    """Загрузка и сохранение содержимого актов."""

    def __init__(
        self,
        conn: asyncpg.Connection,
        settings: Settings,
        acts_settings: ActsSettings,
        *,
        access: ActAccessRepository | None = None,
        lock: ActLockRepository | None = None,
        crud: ActCrudRepository | None = None,
        content: ActContentRepository | None = None,
        invoice: ActInvoiceRepository | None = None,
    ):
        self.conn = conn
        self.settings = settings
        self.acts_settings = acts_settings
        self._access = access or ActAccessRepository(conn)
        self._lock = lock or ActLockRepository(conn)
        self._crud = crud or ActCrudRepository(conn)
        self._content = content or ActContentRepository(conn)
        self._invoice = invoice or ActInvoiceRepository(conn)
        self.guard = AccessGuard(self._access, self._lock)
        self._audit = ActAuditLogRepository(conn)
        self._versions = ActContentVersionRepository(conn)

    async def get_content(self, act_id: int, username: str) -> dict:
        """
        Загружает полное содержимое акта для редактора.

        Оркестрирует 4 репозитория: crud (метаданные), content (дерево,
        таблицы, текстблоки, нарушения), invoice (фактуры), access (права).
        """
        permission = await self._access.get_user_edit_permission(act_id, username)
        if not permission["has_access"]:
            raise AccessDeniedError("Нет доступа к акту")

        act_metadata = await self._crud.get_act_by_id(act_id)
        content = await self._content.get_content(act_id)

        invoices_list = await self._invoice.get_invoices_for_act(act_id)
        invoices = {inv["node_id"]: inv for inv in invoices_list}

        logger.info(
            f"Загружено содержимое акта ID={act_id}, "
            f"КМ={act_metadata.km_number}, is_process_based={act_metadata.is_process_based}"
        )

        return {
            "metadata": act_metadata.model_dump(mode="json"),
            **content,
            "invoices": invoices,
            "userPermission": {
                "canEdit": permission["can_edit"],
                "role": permission["role"],
            },
        }

    async def save_content(self, act_id: int, data: ActDataSchema, username: str) -> dict:
        """Сохраняет содержимое акта."""
        await self.guard.require_edit_permission(act_id, username)
        await self.guard.require_lock_owner(act_id, username)

        # Валидация дерева перед сохранением
        self._validate_tree(data)

        # Вычисляем diff ДО сохранения
        diff = await self._audit.compute_content_diff(act_id, data)
        diff["save_type"] = data.saveType

        # Вычисляем field-level diff для изменённых элементов
        field_changes = await self._audit.compute_field_diffs(act_id, data)
        if field_changes:
            diff["field_changes"] = field_changes

        # Сохраняем содержимое
        result = await self._content.save_content(act_id, data, username)

        # Записываем в аудит-лог (fire-and-forget)
        await self._audit.log("content_save", username, act_id, diff, changelog=data.changelog)

        # Создаём снэпшот версии только для manual/periodic
        if data.saveType in ("manual", "periodic"):
            await self._versions.create_version(
                act_id=act_id,
                username=username,
                save_type=data.saveType,
                tree=data.tree,
                tables={tid: t.model_dump(mode="json") for tid, t in data.tables.items()},
                textblocks={tid: t.model_dump(mode="json") for tid, t in data.textBlocks.items()},
                violations={vid: v.model_dump(mode="json") for vid, v in data.violations.items()},
                max_versions=self.acts_settings.audit_log.max_content_versions,
            )

        return result

    def _validate_tree(self, data: ActDataSchema) -> None:
        """Проверяет структуру дерева перед сохранением."""
        tree = data.tree
        if not tree:
            return

        # Проверка глубины
        depth = ActTreeUtils.calculate_tree_depth(tree)
        if depth > self.acts_settings.resource.max_tree_depth:
            raise ActValidationError(
                f"Глубина дерева ({depth}) превышает максимум ({self.acts_settings.resource.max_tree_depth})"
            )

        # Проверка наличия корневого узла
        if not tree.get('id'):
            raise ActValidationError("Дерево должно иметь корневой узел с id")
