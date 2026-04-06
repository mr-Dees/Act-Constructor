"""Тесты для AdminRepository."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg

from app.domains.admin.repositories.admin_repository import AdminRepository
from app.domains.admin.settings import AdminSettings


@pytest.fixture
def settings():
    """Настройки админа для тестов."""
    return AdminSettings()


@pytest.fixture
def repo(mock_conn, settings):
    """Создаёт AdminRepository с замоканным адаптером и соединением."""
    mock_adapter = MagicMock()
    mock_adapter.get_table_name = lambda name: name
    mock_adapter.qualify_table_name = lambda name, schema="": name
    mock_adapter.supports_on_conflict = MagicMock(return_value=True)
    with patch(
        "app.db.repositories.base.get_adapter", return_value=mock_adapter
    ):
        return AdminRepository(conn=mock_conn, settings=settings)


# -------------------------------------------------------------------------
# get_all_roles
# -------------------------------------------------------------------------


class TestGetAllRoles:

    async def test_returns_list(self, repo, mock_conn):
        """Возвращает список всех ролей."""
        mock_conn.fetch.return_value = [
            {"id": 1, "name": "Админ", "domain_name": None, "description": ""},
            {"id": 2, "name": "ЦК Фин.Рез.", "domain_name": "ck_fin_res", "description": ""},
        ]
        result = await repo.get_all_roles()

        assert len(result) == 2
        assert result[0]["name"] == "Админ"
        assert result[1]["domain_name"] == "ck_fin_res"


# -------------------------------------------------------------------------
# get_role_by_name / get_role_by_id
# -------------------------------------------------------------------------


class TestGetRole:

    async def test_by_name_found(self, repo, mock_conn):
        """Возвращает роль по имени."""
        mock_conn.fetchrow.return_value = {"id": 1, "name": "Админ", "domain_name": None, "description": ""}
        result = await repo.get_role_by_name("Админ")

        assert result is not None
        assert result["id"] == 1

    async def test_by_name_not_found(self, repo, mock_conn):
        """Возвращает None, если роль не найдена."""
        mock_conn.fetchrow.return_value = None
        result = await repo.get_role_by_name("Несуществующая")

        assert result is None

    async def test_by_id_found(self, repo, mock_conn):
        """Возвращает роль по id."""
        mock_conn.fetchrow.return_value = {"id": 1, "name": "Админ", "domain_name": None, "description": ""}
        result = await repo.get_role_by_id(1)

        assert result is not None
        assert result["name"] == "Админ"

    async def test_by_id_not_found(self, repo, mock_conn):
        """Возвращает None, если роль не найдена."""
        mock_conn.fetchrow.return_value = None
        result = await repo.get_role_by_id(999)

        assert result is None


# -------------------------------------------------------------------------
# get_user_roles
# -------------------------------------------------------------------------


class TestGetUserRoles:

    async def test_returns_roles(self, repo, mock_conn):
        """Возвращает список ролей пользователя."""
        mock_conn.fetch.return_value = [
            {"id": 1, "name": "Админ", "domain_name": None, "description": ""},
        ]
        result = await repo.get_user_roles("testuser")

        assert len(result) == 1
        assert result[0]["name"] == "Админ"
        query = mock_conn.fetch.call_args[0][0]
        assert "JOIN" in query

    async def test_empty_roles(self, repo, mock_conn):
        """Возвращает пустой список, если ролей нет."""
        mock_conn.fetch.return_value = []
        result = await repo.get_user_roles("newuser")

        assert result == []


# -------------------------------------------------------------------------
# assign_role (PostgreSQL ветка — ON CONFLICT)
# -------------------------------------------------------------------------


class TestAssignRolePG:

    async def test_assigned(self, repo, mock_conn):
        """Возвращает True при успешном назначении."""
        mock_conn.execute.return_value = "INSERT 0 1"
        result = await repo.assign_role("testuser", 1, "admin")

        assert result is True
        query = mock_conn.execute.call_args[0][0]
        assert "ON CONFLICT" in query

    async def test_already_exists(self, repo, mock_conn):
        """Возвращает False, если роль уже назначена."""
        mock_conn.execute.return_value = "INSERT 0 0"
        result = await repo.assign_role("testuser", 1, "admin")

        assert result is False


# -------------------------------------------------------------------------
# assign_role (GreenPlum ветка — check-then-insert)
# -------------------------------------------------------------------------


class TestAssignRoleGP:

    @pytest.fixture(autouse=True)
    def _gp_adapter(self, repo):
        """Переключает адаптер в GP-режим."""
        repo.adapter.supports_on_conflict.return_value = False

    async def test_assigned(self, repo, mock_conn):
        """Возвращает True при новом назначении в GP."""
        mock_conn.fetchval.return_value = None
        result = await repo.assign_role("testuser", 1, "admin")

        assert result is True
        mock_conn.execute.assert_called_once()

    async def test_already_exists(self, repo, mock_conn):
        """Возвращает False, если роль уже назначена в GP."""
        mock_conn.fetchval.return_value = 1
        result = await repo.assign_role("testuser", 1, "admin")

        assert result is False
        mock_conn.execute.assert_not_called()

    async def test_unique_violation_handled(self, repo, mock_conn):
        """Перехватывает UniqueViolationError при race condition."""
        mock_conn.fetchval.return_value = None
        mock_conn.execute.side_effect = asyncpg.UniqueViolationError("")
        result = await repo.assign_role("testuser", 1, "admin")

        assert result is False


# -------------------------------------------------------------------------
# remove_role
# -------------------------------------------------------------------------


class TestRemoveRole:

    async def test_success(self, repo, mock_conn):
        """Возвращает True при успешном удалении."""
        mock_conn.execute.return_value = "DELETE 1"
        result = await repo.remove_role("testuser", 1)

        assert result is True

    async def test_not_found(self, repo, mock_conn):
        """Возвращает False, если связка не найдена."""
        mock_conn.execute.return_value = "DELETE 0"
        result = await repo.remove_role("testuser", 999)

        assert result is False


# -------------------------------------------------------------------------
# bulk_assign_roles
# -------------------------------------------------------------------------


class TestBulkAssignRoles:

    async def test_assigns_in_transaction(self, repo, mock_conn):
        """Назначение ролей происходит в транзакции."""
        mock_conn.execute.return_value = "INSERT 0 1"
        assignments = [
            ("user1", 1, "admin"),
            ("user2", 1, "admin"),
        ]
        result = await repo.bulk_assign_roles(assignments)

        assert result == 2
        mock_conn.transaction.assert_called_once()


# -------------------------------------------------------------------------
# count_admins
# -------------------------------------------------------------------------


class TestCountAdmins:

    async def test_returns_count(self, repo, mock_conn):
        """Возвращает количество администраторов."""
        mock_conn.fetchval.return_value = 3
        result = await repo.count_admins()

        assert result == 3
        query = mock_conn.fetchval.call_args[0][0]
        assert "JOIN" in query
        assert mock_conn.fetchval.call_args[0][1] == "Админ"

    async def test_zero_admins(self, repo, mock_conn):
        """Возвращает 0, если администраторов нет."""
        mock_conn.fetchval.return_value = 0
        result = await repo.count_admins()

        assert result == 0


# -------------------------------------------------------------------------
# count_user_roles
# -------------------------------------------------------------------------


class TestCountUserRoles:

    async def test_returns_count(self, repo, mock_conn):
        """Возвращает количество записей в user_roles."""
        mock_conn.fetchval.return_value = 42
        result = await repo.count_user_roles()

        assert result == 42


# -------------------------------------------------------------------------
# search_users
# -------------------------------------------------------------------------


class TestSearchUsers:

    async def test_escapes_special_chars(self, repo, mock_conn):
        """Экранирует спецсимволы LIKE в поисковом запросе."""
        mock_conn.fetch.return_value = []
        await repo.search_users("test%user", "branch1")

        pattern = mock_conn.fetch.call_args[0][1]
        assert "\\%" in pattern

    async def test_returns_results(self, repo, mock_conn):
        """Возвращает список найденных пользователей."""
        mock_conn.fetch.return_value = [
            {"username": "12345", "fullname": "Иванов И.И.", "job": "Аудитор", "email": ""},
        ]
        result = await repo.search_users("Иванов", "branch1")

        assert len(result) == 1
        assert result[0]["fullname"] == "Иванов И.И."


# -------------------------------------------------------------------------
# get_users_with_roles
# -------------------------------------------------------------------------


class TestGetUsersWithRoles:

    async def test_parses_json_roles(self, repo, mock_conn):
        """Корректно парсит JSON-роли (строковый вариант)."""
        mock_conn.fetch.return_value = [
            {
                "username": "12345",
                "fullname": "Иванов И.И.",
                "job": "Аудитор",
                "tn": "12345",
                "email": "",
                "is_department": True,
                "roles": '[{"id": 1, "name": "Админ", "domain_name": null, "description": ""}]',
            },
        ]
        result = await repo.get_users_with_roles("branch1")

        assert len(result) == 1
        assert isinstance(result[0]["roles"], list)
        assert result[0]["roles"][0]["name"] == "Админ"

    async def test_parses_list_roles(self, repo, mock_conn):
        """Корректно обрабатывает роли как list (asyncpg десериализация)."""
        mock_conn.fetch.return_value = [
            {
                "username": "12345",
                "fullname": "Петров П.П.",
                "job": "",
                "tn": "",
                "email": "",
                "is_department": False,
                "roles": [{"id": 2, "name": "ЦК", "domain_name": "ck_fin_res", "description": ""}],
            },
        ]
        result = await repo.get_users_with_roles("branch1")

        assert len(result) == 1
        assert result[0]["roles"][0]["domain_name"] == "ck_fin_res"
