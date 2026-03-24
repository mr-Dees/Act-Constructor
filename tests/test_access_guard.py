"""Тесты для AccessGuard — проверки доступа к актам."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.domains.acts.exceptions import (
    AccessDeniedError,
    ActLockError,
    InsufficientRightsError,
    ManagementRoleRequiredError,
)
from app.domains.acts.services.access_guard import AccessGuard


@pytest.fixture
def access_repo():
    repo = AsyncMock()
    repo.check_user_access = AsyncMock()
    repo.get_user_edit_permission = AsyncMock()
    return repo


@pytest.fixture
def lock_repo():
    repo = AsyncMock()
    repo.get_lock_info = AsyncMock()
    return repo


@pytest.fixture
def guard(access_repo, lock_repo):
    return AccessGuard(access_repo=access_repo, lock_repo=lock_repo)


class TestRequireAccess:

    async def test_success(self, guard, access_repo):
        access_repo.check_user_access.return_value = True
        await guard.require_access(1, "user1")

    async def test_denied(self, guard, access_repo):
        access_repo.check_user_access.return_value = False
        with pytest.raises(AccessDeniedError):
            await guard.require_access(1, "user1")


class TestRequireEditPermission:

    async def test_success(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": True,
            "can_edit": True,
            "role": "Редактор",
        }
        result = await guard.require_edit_permission(1, "user1")
        assert result["role"] == "Редактор"

    async def test_no_access(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": False,
            "can_edit": False,
            "role": None,
        }
        with pytest.raises(AccessDeniedError):
            await guard.require_edit_permission(1, "user1")

    async def test_readonly(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": True,
            "can_edit": False,
            "role": "Участник",
        }
        with pytest.raises(InsufficientRightsError):
            await guard.require_edit_permission(1, "user1")


class TestRequireManagementRole:

    async def test_curator(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": True,
            "can_edit": True,
            "role": "Куратор",
        }
        result = await guard.require_management_role(1, "user1")
        assert result["role"] == "Куратор"

    async def test_leader(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": True,
            "can_edit": True,
            "role": "Руководитель",
        }
        result = await guard.require_management_role(1, "user1")
        assert result["role"] == "Руководитель"

    async def test_editor_denied(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": True,
            "can_edit": True,
            "role": "Редактор",
        }
        with pytest.raises(ManagementRoleRequiredError):
            await guard.require_management_role(1, "user1")

    async def test_no_access(self, guard, access_repo):
        access_repo.get_user_edit_permission.return_value = {
            "has_access": False,
            "can_edit": False,
            "role": None,
        }
        with pytest.raises(AccessDeniedError):
            await guard.require_management_role(1, "user1")


class TestRequireLockOwner:

    async def test_success(self, guard, lock_repo):
        lock_repo.get_lock_info.return_value = {
            "locked_by": "user1",
            "lock_expires_at": "2026-03-24T12:00:00",
        }
        await guard.require_lock_owner(1, "user1")

    async def test_not_locked(self, guard, lock_repo):
        lock_repo.get_lock_info.return_value = {"locked_by": None}
        with pytest.raises(ActLockError):
            await guard.require_lock_owner(1, "user1")

    async def test_other_user(self, guard, lock_repo):
        lock_repo.get_lock_info.return_value = {
            "locked_by": "user2",
            "lock_expires_at": "2026-03-24T12:00:00",
        }
        with pytest.raises(ActLockError, match="user2"):
            await guard.require_lock_owner(1, "user1")
