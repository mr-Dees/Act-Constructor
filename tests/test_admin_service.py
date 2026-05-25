"""Тесты для AdminService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.domains.admin.exceptions import RoleNotFoundError, UserNotFoundError
from app.domains.admin.services.admin_service import AdminService
from app.domains.admin.settings import AdminSettings


@pytest.fixture
def settings():
    return AdminSettings()


@pytest.fixture
def mock_repo():
    return AsyncMock()


@pytest.fixture
def service(mock_conn, settings, mock_repo):
    mock_adapter = MagicMock()
    mock_adapter.get_table_name = lambda name: name
    mock_adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        svc = AdminService(conn=mock_conn, settings=settings)
    svc.repo = mock_repo
    return svc


class TestGetUserDirectory:

    async def test_passes_branch_filter(self, service, mock_repo):
        mock_repo.get_users_with_roles.return_value = []
        mock_repo.count_users_with_roles.return_value = 0
        items, total = await service.get_user_directory()
        mock_repo.get_users_with_roles.assert_called_once_with(
            "Отдел аудита розничного бизнеса", limit=50, offset=0,
        )
        mock_repo.count_users_with_roles.assert_called_once_with(
            "Отдел аудита розничного бизнеса",
        )
        assert items == []
        assert total == 0

    async def test_returns_users(self, service, mock_repo):
        mock_repo.get_users_with_roles.return_value = [
            {"username": "22494524", "fullname": "Маштаков Д.Р.", "roles": [], "is_department": True},
        ]
        mock_repo.count_users_with_roles.return_value = 1
        items, total = await service.get_user_directory()
        assert len(items) == 1
        assert items[0]["username"] == "22494524"
        assert total == 1


class TestSearchUsers:

    async def test_returns_results(self, service, mock_repo):
        mock_repo.search_users.return_value = [
            {"username": "22501010", "fullname": "Захарова М.Д.", "job": "", "email": ""},
        ]
        mock_repo.count_search_users.return_value = 1
        items, total = await service.search_users("Захарова")
        mock_repo.search_users.assert_called_once_with(
            "Захарова", "Отдел аудита розничного бизнеса", limit=50, offset=0,
        )
        mock_repo.count_search_users.assert_called_once_with(
            "Захарова", "Отдел аудита розничного бизнеса",
        )
        assert len(items) == 1
        assert total == 1

    async def test_empty_query_returns_empty(self, service, mock_repo):
        items, total = await service.search_users("")
        mock_repo.search_users.assert_not_called()
        assert items == []
        assert total == 0

    async def test_short_query_returns_empty(self, service, mock_repo):
        items, total = await service.search_users("З")
        mock_repo.search_users.assert_not_called()
        assert items == []
        assert total == 0


class TestAssignRoleValidation:

    async def test_user_not_in_directory_raises(self, service, mock_repo):
        mock_repo.get_role_by_id.return_value = {"id": 1, "name": "Админ"}
        mock_repo.get_user_from_directory.return_value = None
        with pytest.raises(UserNotFoundError):
            await service.assign_role("99999999", 1, "admin")

    async def test_user_in_directory_succeeds(self, service, mock_repo):
        mock_repo.get_role_by_id.return_value = {"id": 1, "name": "Админ"}
        mock_repo.get_user_from_directory.return_value = {"username": "22501010"}
        mock_repo.assign_role.return_value = True
        result = await service.assign_role("22501010", 1, "admin")
        assert result is True

    async def test_role_not_found_raises(self, service, mock_repo):
        mock_repo.get_role_by_id.return_value = None
        with pytest.raises(RoleNotFoundError):
            await service.assign_role("22501010", 999, "admin")
