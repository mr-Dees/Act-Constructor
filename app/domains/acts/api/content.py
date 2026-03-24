"""
API эндпоинты для работы с содержимым актов.

Тонкие обёртки — вся логика в ActContentService.
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import get_content_service, get_invoice_service
from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.schemas.act_responses import SaveContentResponse
from app.domains.acts.services.act_content_service import ActContentService
from app.domains.acts.services.act_invoice_service import ActInvoiceService

router = APIRouter()


@router.get("/{act_id}/content")
async def get_act_content(
    act_id: int,
    username: str = Depends(get_username),
    service: ActContentService = Depends(get_content_service),
) -> dict:
    """Получает полное содержимое акта для редактора."""
    return await service.get_content(act_id, username)


@router.put("/{act_id}/content", response_model=SaveContentResponse)
async def save_act_content(
    act_id: int,
    data: ActDataSchema,
    username: str = Depends(get_username),
    service: ActContentService = Depends(get_content_service),
) -> dict:
    """Сохраняет содержимое акта."""
    return await service.save_content(act_id, data, username)


@router.get("/{act_id}/invoices")
async def get_act_invoices(
    act_id: int,
    username: str = Depends(get_username),
    service: ActInvoiceService = Depends(get_invoice_service),
) -> list[dict]:
    """Получает список всех фактур для акта."""
    return await service.get_invoices(act_id, username)
