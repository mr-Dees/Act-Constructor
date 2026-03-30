"""Сервис аудит-лога и версионирования."""

import logging

from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.repositories.act_content import ActContentRepository

logger = logging.getLogger("audit_workstation.service.acts.audit_log")


class AuditLogService:
    """Операции аудит-лога: восстановление версий."""

    def __init__(self, guard, audit_repo, versions_repo, conn):
        self.guard = guard
        self.audit_repo = audit_repo
        self.versions_repo = versions_repo
        self.conn = conn

    async def restore_version(self, act_id: int, version_id: int, username: str) -> dict:
        """Восстанавливает содержимое акта из указанной версии."""
        await self.guard.require_management_role(act_id, username)
        await self.guard.require_lock_owner(act_id, username)

        version = await self.versions_repo.get_version(act_id, version_id)
        if not version:
            from app.domains.acts.exceptions import ActNotFoundError
            raise ActNotFoundError(f"Версия {version_id} не найдена")

        content_repo = ActContentRepository(self.conn)

        restore_data = ActDataSchema(
            tree=version["tree_data"],
            tables=version.get("tables_data", {}),
            textBlocks=version.get("textblocks_data", {}),
            violations=version.get("violations_data", {}),
            saveType="manual",
        )

        await content_repo.save_content(act_id, restore_data, username)

        await self.audit_repo.log("restore", username, act_id, {
            "from_version": version["version_number"],
            "version_id": version_id,
        })

        await self.versions_repo.create_version(
            act_id=act_id,
            username=username,
            save_type="manual",
            tree=version["tree_data"],
            tables=version.get("tables_data", {}),
            textblocks=version.get("textblocks_data", {}),
            violations=version.get("violations_data", {}),
        )

        logger.info(
            f"Восстановлено содержимое акта ID={act_id} из версии "
            f"#{version['version_number']} пользователем {username}"
        )

        return {
            "success": True,
            "message": f"Содержимое восстановлено из версии #{version['version_number']}",
            "restored_version": version["version_number"],
        }
