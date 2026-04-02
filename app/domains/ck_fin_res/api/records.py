"""
API эндпоинты для записей FR-валидации.

Проверка доступа: require_domain_access("ck_fin_res") применяется
на каждом эндпоинте через dependencies.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import require_domain_access
from app.domains.ck_fin_res.deps import get_fr_validation_service
from app.domains.ck_fin_res.schemas.fr_validation import (
    FRValidationBatchItem,
    FRValidationCreate,
)
from app.domains.ck_fin_res.schemas.requests import ValidationSearchRequest
from app.domains.ck_fin_res.services.fr_validation_service import FRValidationService

MAX_BATCH_SIZE = 500

_access = Depends(require_domain_access("ck_fin_res"))

router = APIRouter()


@router.post("/records/search", dependencies=[_access])
async def search_records(
    body: ValidationSearchRequest,
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Поиск записей FR-валидации по фильтрам."""
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
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Возвращает запись FR-валидации по ID."""
    return await service.get_record(record_id)


@router.post("/records", status_code=201, dependencies=[_access])
async def create_record(
    body: FRValidationCreate,
    username: str = Depends(get_username),
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Создаёт новую запись FR-валидации."""
    return await service.create_record(body.model_dump(), username)


@router.post("/records/batch-update", dependencies=[_access])
async def batch_update_records(
    body: list[FRValidationBatchItem],
    username: str = Depends(get_username),
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Пакетное обновление записей FR-валидации."""
    if len(body) > MAX_BATCH_SIZE:
        return JSONResponse(
            status_code=422,
            content={"detail": f"Максимальный размер пакета: {MAX_BATCH_SIZE}"},
        )
    items = [item.model_dump() for item in body]
    count = await service.batch_update_records(items, username)
    return {"updated": count}


@router.delete("/records/{record_id}", status_code=204, dependencies=[_access])
async def delete_record(
    record_id: int,
    username: str = Depends(get_username),
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Мягкое удаление записи FR-валидации."""
    await service.delete_record(record_id, username)
