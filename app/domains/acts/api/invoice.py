"""
API эндпоинты для работы с фактурами актов.

Тонкие обёртки — вся логика в ActInvoiceService.
"""

from typing import Literal

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.schemas.errors import ErrorDetail
from app.domains.acts.deps import get_invoice_service
from app.domains.acts.schemas.act_invoice import InvoiceSave, InvoiceVerifyRequest
from app.domains.acts.services.act_invoice_service import ActInvoiceService

DbType = Literal["hive", "greenplum"]

router = APIRouter()


@router.get("/metrics")
async def list_metrics(
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает справочник метрик."""
    return await service.list_metrics()


@router.get("/processes")
async def list_processes(
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает справочник процессов."""
    return await service.list_processes()


@router.get("/subsidiaries")
async def list_subsidiaries(
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает справочник подразделений."""
    return await service.list_subsidiaries()


@router.get(
    "/tables/{db_type}",
    responses={400: {"description": "Неподдерживаемый тип БД", "model": ErrorDetail}},
)
async def list_tables(
    db_type: DbType,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает полный список таблиц в указанной БД."""
    return await service.list_tables(db_type)


@router.post(
    "/save",
    responses={
        400: {"description": "Ошибка при сохранении фактуры", "model": ErrorDetail},
        403: {"description": "Нет доступа к акту", "model": ErrorDetail},
        404: {"description": "Акт не найден", "model": ErrorDetail},
        422: {"description": "Ошибка валидации входных данных"},
    },
)
async def save_invoice(
    data: InvoiceSave,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> dict:
    """Сохраняет фактуру (UPSERT по act_id + node_id)."""
    return await service.save_invoice(data.model_dump(), username)


@router.post(
    "/verify",
    responses={
        400: {"description": "Ошибка верификации", "model": ErrorDetail},
        404: {"description": "Фактура не найдена", "model": ErrorDetail},
    },
)
async def verify_invoice(
    data: InvoiceVerifyRequest,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> dict:
    """Верификация фактуры (TODO-заглушка)."""
    return await service.verify_invoice(data.invoice_id, data.act_id, username)
