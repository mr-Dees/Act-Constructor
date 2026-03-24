"""
API эндпоинты для управления актами.

Тонкие обёртки — вся логика в сервисах.
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.core.settings_registry import get as get_domain_settings
from app.domains.acts.deps import get_crud_service, get_lock_service
from app.domains.acts.schemas.act_metadata import ActCreate, ActUpdate, ActListItem, ActResponse, AuditPointIdsRequest
from app.domains.acts.schemas.act_responses import (
    LockConfigResponse,
    LockResponse,
    InvoiceConfigResponse,
    OperationResult,
)
from app.domains.acts.services.act_crud_service import ActCrudService
from app.domains.acts.services.act_lock_service import ActLockService
from app.domains.acts.settings import ActsSettings

router = APIRouter()


@router.get("/list", response_model=list[ActListItem])
async def list_user_acts(
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Получает список актов пользователя (только те, где участвует)."""
    return await service.list_acts(username)


@router.post("/{act_id}/lock", response_model=LockResponse, status_code=200)
async def lock_act(
        act_id: int,
        username: str = Depends(get_username),
        service: ActLockService = Depends(get_lock_service),
):
    """Блокирует акт для редактирования текущим пользователем."""
    return await service.lock_act(act_id, username)


@router.post("/{act_id}/unlock", response_model=OperationResult, status_code=200)
async def unlock_act(
        act_id: int,
        username: str = Depends(get_username),
        service: ActLockService = Depends(get_lock_service),
):
    """Снимает блокировку с акта."""
    return await service.unlock_act(act_id, username)


@router.post("/{act_id}/extend-lock", response_model=LockResponse, status_code=200)
async def extend_lock(
        act_id: int,
        username: str = Depends(get_username),
        service: ActLockService = Depends(get_lock_service),
):
    """Продлевает блокировку акта."""
    return await service.extend_lock(act_id, username)


@router.post("/create", response_model=ActResponse, status_code=201)
async def create_act(
        act_data: ActCreate,
        username: str = Depends(get_username),
        force_new_part: bool = False,
        service: ActCrudService = Depends(get_crud_service),
):
    """Создает новый акт с метаданными и связанными сущностями."""
    return await service.create_act(act_data, username, force_new_part)


@router.get("/config/lock", response_model=LockConfigResponse)
async def get_lock_config():
    """Получает настройки блокировок для фронтенда."""
    acts_cfg = get_domain_settings("acts", ActsSettings)

    return {
        "lockDurationMinutes": acts_cfg.lock.duration_minutes,
        "inactivityTimeoutMinutes": acts_cfg.lock.inactivity_timeout_minutes,
        "inactivityCheckIntervalSeconds": acts_cfg.lock.inactivity_check_interval_seconds,
        "minExtensionIntervalMinutes": acts_cfg.lock.min_extension_interval_minutes,
        "inactivityDialogTimeoutSeconds": acts_cfg.lock.inactivity_dialog_timeout_seconds,
    }


@router.get("/config/invoice", response_model=InvoiceConfigResponse)
async def get_invoice_config():
    """Получает настройки схем для фактур (для фронтенда)."""
    acts_cfg = get_domain_settings("acts", ActsSettings)

    return {
        "hiveSchema": acts_cfg.invoice.hive_schema,
        "gpSchema": acts_cfg.invoice.gp_schema,
    }


@router.get("/{act_id}", response_model=ActResponse)
async def get_act(
        act_id: int,
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Получает полную информацию об акте."""
    return await service.get_act(act_id, username)


@router.patch("/{act_id}", response_model=ActResponse)
async def update_act_metadata(
        act_id: int,
        act_update: ActUpdate,
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Обновляет метаданные акта (частичное обновление)."""
    return await service.update_act_metadata(act_id, act_update, username)


@router.post("/{act_id}/duplicate", response_model=ActResponse)
async def duplicate_act(
        act_id: int,
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Создает дубликат акта."""
    return await service.duplicate_act(act_id, username)


@router.post("/{act_id}/audit-point-ids", response_model=dict[str, str])
async def generate_audit_point_ids(
        act_id: int,
        request: AuditPointIdsRequest,
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Генерирует audit_point_id для списка узлов дерева акта."""
    return await service.generate_audit_point_ids(act_id, request.node_ids, username)


@router.delete("/{act_id}", response_model=OperationResult)
async def delete_act(
        act_id: int,
        username: str = Depends(get_username),
        service: ActCrudService = Depends(get_crud_service),
):
    """Удаляет акт и все связанные данные."""
    return await service.delete_act(act_id, username)
