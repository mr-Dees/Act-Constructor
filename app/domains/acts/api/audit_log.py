"""
API эндпоинты аудит-лога и версий содержимого.

Доступны только для ролей Куратор и Руководитель.
"""

import logging

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import get_audit_log_service
from app.domains.acts.schemas.act_audit_log import (
    AuditLogResponse,
    ContentVersionDetail,
    ContentVersionsResponse,
)

logger = logging.getLogger("act_constructor.api.audit_log")
router = APIRouter()


@router.get("/{act_id}/audit-log", response_model=AuditLogResponse)
async def get_audit_log(
    act_id: int,
    username: str = Depends(get_username),
    action: str | None = Query(None, description="Фильтр по типу операции"),
    audit_username: str | None = Query(None, alias="username", description="Фильтр по пользователю"),
    from_date: str | None = Query(None, description="Дата начала (ISO)"),
    to_date: str | None = Query(None, description="Дата конца (ISO)"),
    limit: int = Query(50, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    service=Depends(get_audit_log_service),
) -> AuditLogResponse:
    """Получает записи аудит-лога акта с фильтрацией."""
    guard, audit_repo, _ = service

    await guard.require_management_role(act_id, username)

    items, total = await audit_repo.get_log(
        act_id,
        action=action,
        username=audit_username,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
        offset=offset,
    )
    return AuditLogResponse(items=items, total=total)


@router.get("/{act_id}/versions", response_model=ContentVersionsResponse)
async def get_versions(
    act_id: int,
    username: str = Depends(get_username),
    limit: int = Query(50, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    service=Depends(get_audit_log_service),
) -> ContentVersionsResponse:
    """Получает список версий содержимого акта."""
    guard, _, versions_repo = service

    await guard.require_management_role(act_id, username)

    items, total = await versions_repo.get_versions_list(
        act_id, limit=limit, offset=offset,
    )
    return ContentVersionsResponse(items=items, total=total)


@router.get("/{act_id}/versions/{version_id}", response_model=ContentVersionDetail)
async def get_version(
    act_id: int,
    version_id: int,
    username: str = Depends(get_username),
    service=Depends(get_audit_log_service),
) -> ContentVersionDetail:
    """Получает полный снэпшот конкретной версии."""
    guard, _, versions_repo = service

    await guard.require_management_role(act_id, username)

    version = await versions_repo.get_version(act_id, version_id)
    if not version:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Версия не найдена")
    return ContentVersionDetail(**version)


@router.post("/{act_id}/versions/{version_id}/restore")
async def restore_version(
    act_id: int,
    version_id: int,
    username: str = Depends(get_username),
    service=Depends(get_audit_log_service),
) -> dict:
    """Восстанавливает содержимое из указанной версии."""
    guard, audit_repo, versions_repo = service

    await guard.require_management_role(act_id, username)
    await guard.require_lock_owner(act_id, username)

    version = await versions_repo.get_version(act_id, version_id)
    if not version:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Версия не найдена")

    # Импортируем сервис содержимого для восстановления
    from app.domains.acts.schemas.act_content import ActDataSchema
    from app.domains.acts.repositories.act_content import ActContentRepository

    content_repo = ActContentRepository(audit_repo.conn)

    # Формируем данные из снэпшота
    restore_data = ActDataSchema(
        tree=version["tree_data"],
        tables=version.get("tables_data", {}),
        textBlocks=version.get("textblocks_data", {}),
        violations=version.get("violations_data", {}),
        saveType="manual",
    )

    # Сохраняем через репозиторий (guard уже проверен — role + lock)
    await content_repo.save_content(act_id, restore_data, username)

    # Создаём запись в аудит-лог
    await audit_repo.log("restore", username, act_id, {
        "from_version": version["version_number"],
        "version_id": version_id,
    })

    # Создаём новый снэпшот после восстановления
    await versions_repo.create_version(
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
