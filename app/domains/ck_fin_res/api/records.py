"""
API эндпоинты записей FR-валидации (групповая модель: строка = пункт × метрика).

Проверка доступа: require_domain_access("ck_fin_res") на каждом эндпоинте.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger("audit_workstation.api.ck_fin_res.records")

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.core.responses import PaginatedResponse
from app.domains.ck_fin_res.deps import get_fr_validation_service
from app.domains.ck_fin_res.exceptions import FRGroupConflictError
from app.domains.ck_fin_res.schemas.group import FRGroupDeleteRequest, FRGroupSaveRequest
from app.domains.ck_fin_res.schemas.requests import ValidationSearchRequest
from app.domains.ck_fin_res.services.fr_validation_service import FRValidationService

_access = Depends(require_domain_access("ck_fin_res"))

router = APIRouter()


@router.post(
    "/records/search",
    response_model=PaginatedResponse[dict],
    dependencies=[_access],
)
async def search_records(
    body: ValidationSearchRequest,
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Групповой поиск: страница логических строк с разверткой по ТБ."""
    result = await service.search(
        filters=body.filters,
        sort=[(s.by, s.dir) for s in body.sort] or None,
        limit=body.limit,
        offset=body.offset,
    )
    return PaginatedResponse[dict](**result)


@router.get("/records/{record_id}", dependencies=[_access])
async def get_record(
    record_id: int,
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Возвращает одну физическую строку по ID (отладка/диплинки)."""
    return await service.get_record(record_id)


@router.post("/records/group-save", dependencies=[_access])
async def group_save(
    body: FRGroupSaveRequest,
    username: str = Depends(get_username),
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Дифференциальное сохранение группы: общие поля + развертка по ТБ."""
    try:
        result = await service.group_save(body, username)
    except FRGroupConflictError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    logger.info("Групповое сохранение ЦКФР пользователем %s: %s", username, result)
    return result


@router.post("/records/group-delete", dependencies=[_access])
async def group_delete(
    body: FRGroupDeleteRequest,
    username: str = Depends(get_username),
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Групповое удаление: деактивация всех строк группы."""
    try:
        deleted = await service.group_delete(body, username)
    except FRGroupConflictError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    logger.info("Групповое удаление ЦКФР пользователем %s: %s строк", username, deleted)
    return {"deleted": deleted}
