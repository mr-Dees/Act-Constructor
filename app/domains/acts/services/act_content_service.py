"""
Сервис содержимого актов.

Загрузка и сохранение содержимого: дерево, таблицы, текстблоки, нарушения.
"""

import logging

import asyncpg

from app.core.config import Settings
from app.core.settings_registry import get as get_domain_settings
from app.domains.acts.exceptions import AccessDeniedError, ActValidationError
from app.domains.acts.repositories.act_access import ActAccessRepository
from app.domains.acts.repositories.act_crud import ActCrudRepository
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.repositories.act_invoice import ActInvoiceRepository
from app.domains.acts.repositories.act_lock import ActLockRepository
from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.services.access_guard import AccessGuard
from app.domains.acts.settings import ActsSettings
from app.domains.acts.utils import ActTreeUtils

logger = logging.getLogger("act_constructor.service.acts.content")


class ActContentService:
    """Загрузка и сохранение содержимого актов."""

    def __init__(
        self,
        conn: asyncpg.Connection,
        settings: Settings,
        *,
        access: ActAccessRepository | None = None,
        lock: ActLockRepository | None = None,
        crud: ActCrudRepository | None = None,
        content: ActContentRepository | None = None,
        invoice: ActInvoiceRepository | None = None,
    ):
        self.conn = conn
        self.settings = settings
        self._access = access or ActAccessRepository(conn)
        self._lock = lock or ActLockRepository(conn)
        self._crud = crud or ActCrudRepository(conn)
        self._content = content or ActContentRepository(conn)
        self._invoice = invoice or ActInvoiceRepository(conn)
        self.guard = AccessGuard(self._access, self._lock)

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

        return await self._content.save_content(act_id, data, username)

    @staticmethod
    def _validate_tree(data: ActDataSchema) -> None:
        """Проверяет структуру дерева перед сохранением."""
        tree = data.tree
        if not tree:
            return

        acts_cfg = get_domain_settings("acts", ActsSettings)

        # Проверка глубины
        depth = ActTreeUtils.calculate_tree_depth(tree)
        if depth > acts_cfg.resource.max_tree_depth:
            raise ActValidationError(
                f"Глубина дерева ({depth}) превышает максимум ({acts_cfg.resource.max_tree_depth})"
            )

        # Проверка наличия корневого узла
        if not tree.get('id'):
            raise ActValidationError("Дерево должно иметь корневой узел с id")
