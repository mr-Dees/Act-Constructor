"""Pydantic схемы для эндпоинтов администрирования."""

from pydantic import BaseModel


class RoleSchema(BaseModel):
    """Роль в системе."""
    id: int
    name: str
    domain_name: str | None = None
    description: str = ""


class UserRolesResponse(BaseModel):
    """Ответ с ролями пользователя."""
    username: str
    roles: list[RoleSchema]
    is_admin: bool


class UserDirectoryItem(BaseModel):
    """Пользователь из справочника с назначенными ролями."""
    username: str
    fullname: str
    job: str = ""
    tn: str = ""
    email: str = ""
    roles: list[RoleSchema] = []


class RoleAssignRequest(BaseModel):
    """Запрос на назначение роли пользователю."""
    role_id: int
