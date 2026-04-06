"""
API эндпоинты для записей CS-валидации.

Проверка доступа: require_domain_access("ck_client_exp") применяется
на каждом эндпоинте через dependencies.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger("audit_workstation.api.ck_client_exp.records")

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.ck_client_exp.deps import get_cs_validation_service
from app.domains.ck_client_exp.schemas.cs_validation import (
    CSValidationBatchItem,
    CSValidationCreate,
)
from app.domains.ck_client_exp.schemas.requests import ValidationSearchRequest
from app.domains.ck_client_exp.services.cs_validation_service import CSValidationService

MAX_BATCH_SIZE = 500

_access = Depends(require_domain_access("ck_client_exp"))

router = APIRouter()


@router.post("/records/search", dependencies=[_access])
async def search_records(
    body: ValidationSearchRequest,
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Поиск записей CS-валидации по фильтрам."""
    data = await service.search_records(
        start_date=body.start_date,
        end_date=body.end_date,
        metric_code=body.metric_code or None,
        process_code=body.process_code or None,
        limit=body.limit,
        offset=body.offset,
    )
    return {"data": data}


@router.get("/records/{record_id}", dependencies=[_access])
async def get_record(
    record_id: int,
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Возвращает запись CS-валидации по ID."""
    return await service.get_record(record_id)


@router.post("/records", status_code=201, dependencies=[_access])
async def create_record(
    body: CSValidationCreate,
    username: str = Depends(get_username),
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Создаёт новую запись CS-валидации."""
    result = await service.create_record(body.model_dump(), username)
    logger.info("Создана запись CS-валидации пользователем %s", username)
    return result


@router.post("/records/batch-update", dependencies=[_access])
async def batch_update_records(
    body: list[CSValidationBatchItem],
    username: str = Depends(get_username),
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Пакетное обновление записей CS-валидации."""
    if len(body) > MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=422,
            detail=f"Максимальный размер пакета: {MAX_BATCH_SIZE}",
        )
    items = [item.model_dump() for item in body]
    count = await service.batch_update_records(items, username)
    logger.info("Пакетное обновление CS-валидации: %s записей, пользователь %s", count, username)
    return {"updated": count}


@router.delete("/records/{record_id}", status_code=204, dependencies=[_access])
async def delete_record(
    record_id: int,
    username: str = Depends(get_username),
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Мягкое удаление записи CS-валидации."""
    await service.delete_record(record_id, username)
    logger.info("Удалена запись CS-валидации id=%s пользователем %s", record_id, username)
