"""Сервис аудит-лога и версионирования."""

import logging

from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.repositories.act_content import ActContentRepository
from app.domains.acts.utils.html_sanitizer import sanitize_act_data

logger = logging.getLogger("audit_workstation.service.acts.audit_log")


class AuditLogService:
    """Операции аудит-лога: восстановление версий."""

    def __init__(self, guard, audit_repo, versions_repo, conn):
        self.guard = guard
        self.audit_repo = audit_repo
        self.versions_repo = versions_repo
        self.conn = conn

    async def restore_version(self, act_id: int, version_id: int, username: str) -> dict:
        """Восстанавливает содержимое акта из указанной версии.

        Перед перезаписью делает pre-snapshot текущего содержимого —
        закрывает lost-write: если активный редактор не успел сохранить
        свой state до restore, его последняя сохранённая версия остаётся
        в истории как отдельная запись и доступна для последующего
        восстановления.
        """
        await self.guard.require_management_role(act_id, username)
        await self.guard.require_lock_owner(act_id, username)

        version = await self.versions_repo.get_version(act_id, version_id)
        if not version:
            from app.domains.acts.exceptions import ActNotFoundError
            raise ActNotFoundError(f"Версия {version_id} не найдена")

        content_repo = ActContentRepository(self.conn)

        # Pre-snapshot текущего содержимого ДО перезаписи.
        # get_content вернёт dict {tree, tables, textBlocks, violations, ...};
        # сохраняем как auto-снимок — это не пользовательский save,
        # значения manual/periodic зарезервированы за явными действиями
        # редактора (см. saveType в ActDataSchema).
        current = await content_repo.get_content(act_id)
        if current:
            await self.versions_repo.create_version(
                act_id=act_id,
                username=username,
                save_type="auto",
                tree=current.get("tree", {}),
                tables=current.get("tables", {}),
                textblocks=current.get("textBlocks", {}),
                violations=current.get("violations", {}),
            )

        restore_data = ActDataSchema(
            tree=version["tree_data"],
            tables=version.get("tables_data", {}),
            textBlocks=version.get("textblocks_data", {}),
            violations=version.get("violations_data", {}),
            saveType="manual",
        )

        # XSS-санитизация перед записью: запись идёт мимо
        # ActContentService.save_content, поэтому очищаем HTML-поля той же
        # утилитой, что и обычное сохранение. Иначе старая версия вернула бы
        # несанитизированный HTML в БД (stored XSS).
        sanitize_act_data(restore_data)

        await content_repo.save_content(act_id, restore_data, username)

        await self.audit_repo.log("restore", username, act_id, {
            "from_version": version["version_number"],
            "version_id": version_id,
        })

        # Снимок после восстановления берём из уже санитизированного
        # restore_data, а не из сырых данных версии — иначе в историю
        # попал бы несанитизированный HTML, который при повторном restore
        # вернул бы stored XSS.
        await self.versions_repo.create_version(
            act_id=act_id,
            username=username,
            save_type="manual",
            tree=restore_data.tree,
            tables={tid: t.model_dump(mode="json") for tid, t in restore_data.tables.items()},
            textblocks={tid: t.model_dump(mode="json") for tid, t in restore_data.textBlocks.items()},
            violations={vid: v.model_dump(mode="json") for vid, v in restore_data.violations.items()},
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
