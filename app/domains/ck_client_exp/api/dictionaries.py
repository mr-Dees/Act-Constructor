"""
API эндпоинты для справочников домена ЦК Клиентский опыт.

Проверка доступа: require_domain_access("ck_client_exp") применяется
через dependencies.
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.role_deps import require_domain_access
from app.domains.ck_client_exp.deps import get_cs_validation_service
from app.domains.ck_client_exp.services.cs_validation_service import CSValidationService

_access = Depends(require_domain_access("ck_client_exp"))

router = APIRouter()


@router.get("/dictionaries/{name}", dependencies=[_access])
async def get_dictionary(
    name: str,
    service: CSValidationService = Depends(get_cs_validation_service),
):
    """Возвращает данные справочника по имени."""
    data = await service.get_dictionary(name)
    return {"data": data}
