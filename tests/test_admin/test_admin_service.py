"""Тесты для AdminService."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.domains.admin.exceptions import LastAdminError, RoleNotFoundError
from app.domains.admin.services.admin_service import AdminService
from app.domains.admin.settings import AdminSettings


@pytest.fixture
def mock_repo():
    """Mock AdminRepository."""
    repo = AsyncMock()
    repo.get_role_by_id = AsyncMock()
    repo.count_admins = AsyncMock()
    repo.remove_role = AsyncMock()
    return repo


@pytest.fixture
def service(mock_conn, mock_repo):
    """Создаёт AdminService с замоканным репозиторием."""
    mock_adapter = MagicMock()
    mock_adapter.get_table_name = lambda name: name
    mock_adapter.qualify_table_name = lambda name, schema="": name
    mock_adapter.supports_on_conflict = MagicMock(return_value=True)
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        svc = AdminService(conn=mock_conn, settings=AdminSettings())
    svc.repo = mock_repo
    return svc


# -------------------------------------------------------------------------
# remove_role — защита последнего админа
# -------------------------------------------------------------------------


class TestRemoveRoleLastAdmin:

    async def test_blocks_last_admin_removal(self, service, mock_repo):
        """Нельзя снять роль Админ, если это последний администратор."""
        mock_repo.get_role_by_id.return_value = {
            "id": 1, "name": "Админ", "domain_name": None, "description": "",
        }
        mock_repo.count_admins.return_value = 1

        with pytest.raises(LastAdminError):
            await service.remove_role("12345", 1, "admin_user")

        mock_repo.remove_role.assert_not_called()

    async def test_allows_removal_with_multiple_admins(self, service, mock_repo):
        """Можно снять роль Админ, если администраторов больше одного."""
        mock_repo.get_role_by_id.return_value = {
            "id": 1, "name": "Админ", "domain_name": None, "description": "",
        }
        mock_repo.count_admins.return_value = 2
        mock_repo.remove_role.return_value = True

        result = await service.remove_role("12345", 1, "admin_user")

        assert result is True
        mock_repo.remove_role.assert_called_once_with("12345", 1)

    async def test_non_admin_role_no_count_check(self, service, mock_repo):
        """Для не-админских ролей проверка количества не выполняется."""
        mock_repo.get_role_by_id.return_value = {
            "id": 2, "name": "Цифровой акт", "domain_name": "acts", "description": "",
        }
        mock_repo.remove_role.return_value = True

        result = await service.remove_role("12345", 2, "admin_user")

        assert result is True
        mock_repo.count_admins.assert_not_called()

    async def test_role_not_found(self, service, mock_repo):
        """Ошибка, если роль не существует."""
        mock_repo.get_role_by_id.return_value = None

        with pytest.raises(RoleNotFoundError):
            await service.remove_role("12345", 999, "admin_user")


# -------------------------------------------------------------------------
# remove_role — аудит-логирование
# -------------------------------------------------------------------------


class TestRemoveRoleAuditLog:

    async def test_logs_removed_by(self, service, mock_repo):
        """Лог содержит информацию о том, кто снял роль."""
        mock_repo.get_role_by_id.return_value = {
            "id": 2, "name": "ЦК Фин.Рез.", "domain_name": "ck_fin_res", "description": "",
        }
        mock_repo.remove_role.return_value = True

        with patch("app.domains.admin.services.admin_service.logger") as mock_logger:
            await service.remove_role("12345", 2, "admin_user")

            mock_logger.info.assert_called_once()
            call_args = mock_logger.info.call_args[0]
            assert "admin_user" in call_args
            assert "12345" in call_args

    async def test_no_log_when_not_removed(self, service, mock_repo):
        """Если роль не была назначена — лог не пишется."""
        mock_repo.get_role_by_id.return_value = {
            "id": 2, "name": "ЦК Фин.Рез.", "domain_name": "ck_fin_res", "description": "",
        }
        mock_repo.remove_role.return_value = False

        with patch("app.domains.admin.services.admin_service.logger") as mock_logger:
            result = await service.remove_role("12345", 2, "admin_user")

            assert result is False
            mock_logger.info.assert_not_called()
