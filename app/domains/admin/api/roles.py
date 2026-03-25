"""
API эндпоинты для администрирования ролей.

Проверка прав администратора выполняется на уровне регистрации домена
(require_admin dependency в domain_registry.register_domains).
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import invalidate_roles_cache
from app.domains.admin.deps import get_admin_service
from app.domains.admin.schemas.admin import (
    RoleAssignRequest,
    RoleSchema,
    UserDirectoryItem,
    UserRolesResponse,
    UserSearchResult,
)
from app.domains.admin.services.admin_service import AdminService

router = APIRouter()


@router.get("/roles", response_model=list[RoleSchema])
async def list_roles(
    service: AdminService = Depends(get_admin_service),
):
    """Возвращает список всех ролей системы."""
    return await service.get_all_roles()


@router.get("/users/directory", response_model=list[UserDirectoryItem])
async def get_user_directory(
    service: AdminService = Depends(get_admin_service),
):
    """Возвращает справочник пользователей с назначенными ролями."""
    return await service.get_user_directory()


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = "",
    service: AdminService = Depends(get_admin_service),
):
    """Поиск пользователей в справочнике для добавления в систему."""
    return await service.search_users(q)


@router.get("/users/{username}/roles", response_model=UserRolesResponse)
async def get_user_roles(
    username: str,
    service: AdminService = Depends(get_admin_service),
):
    """Возвращает роли указанного пользователя."""
    return await service.get_user_roles(username)


@router.post("/users/{username}/roles", status_code=200)
async def assign_role(
    username: str,
    body: RoleAssignRequest,
    admin_username: str = Depends(get_username),
    service: AdminService = Depends(get_admin_service),
):
    """Назначает роль пользователю."""
    assigned = await service.assign_role(username, body.role_id, admin_username)
    if assigned:
        invalidate_roles_cache(username)
    return {
        "assigned": assigned,
        "detail": "Роль назначена" if assigned else "Роль уже назначена",
    }


@router.delete("/users/{username}/roles/{role_id}", status_code=200)
async def remove_role(
    username: str,
    role_id: int,
    service: AdminService = Depends(get_admin_service),
):
    """Снимает роль с пользователя."""
    removed = await service.remove_role(username, role_id)
    if removed:
        invalidate_roles_cache(username)
    return {
        "removed": removed,
        "detail": "Роль снята" if removed else "Роль не была назначена",
    }
