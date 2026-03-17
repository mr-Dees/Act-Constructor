"""
API эндпоинты для работы с фактурами актов.

Тонкие обёртки — вся логика в ActInvoiceService.
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import get_invoice_service
from app.domains.acts.schemas.act_invoice import InvoiceSave, InvoiceVerifyRequest
from app.domains.acts.services.act_invoice_service import ActInvoiceService

router = APIRouter()


@router.get("/metrics")
async def list_metrics(
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает справочник метрик."""
    return await service.list_metrics()


@router.get("/tables/{db_type}")
async def list_tables(
    db_type: str,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Возвращает полный список таблиц в указанной БД."""
    return await service.list_tables(db_type)


@router.post("/save")
async def save_invoice(
    data: InvoiceSave,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> dict:
    """Сохраняет фактуру (UPSERT по act_id + node_id)."""
    return await service.save_invoice(data.model_dump(), username)


@router.post("/verify")
async def verify_invoice(
    data: InvoiceVerifyRequest,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> dict:
    """Верификация фактуры (TODO-заглушка)."""
    return await service.verify_invoice(data.invoice_id, data.act_id, username)
