"""
API эндпоинты для справочников домена ЦК Фин.Рез.

Проверка доступа: require_domain_access("ck_fin_res") применяется
через dependencies.
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.role_deps import require_domain_access
from app.domains.ck_fin_res.deps import get_fr_validation_service
from app.domains.ck_fin_res.services.fr_validation_service import FRValidationService

_access = Depends(require_domain_access("ck_fin_res"))

router = APIRouter()


@router.get("/dictionaries/{name}", dependencies=[_access])
async def get_dictionary(
    name: str,
    service: FRValidationService = Depends(get_fr_validation_service),
):
    """Возвращает данные справочника по имени."""
    data = await service.get_dictionary(name)
    return {"data": data}
