"""Тесты для Pydantic-схем администрирования."""

import pytest
from pydantic import ValidationError

from app.domains.admin.schemas.admin import (
    RoleSchema,
    UserDirectoryItem,
    UserSearchResult,
    RoleAssignRequest,
)


class TestUserDirectoryItem:

    def test_department_user_with_roles(self):
        item = UserDirectoryItem(
            username="22494524",
            fullname="Маштаков Денис Романович",
            job="Менеджер направления",
            is_department=True,
            roles=[RoleSchema(id=1, name="Админ")],
        )
        assert item.is_department is True
        assert len(item.roles) == 1

    def test_external_user_without_roles(self):
        item = UserDirectoryItem(
            username="22501010",
            fullname="Захарова Мария Дмитриевна",
            is_department=False,
        )
        assert item.is_department is False
        assert item.roles == []

    def test_defaults(self):
        item = UserDirectoryItem(username="12345678")
        assert item.fullname == ""
        assert item.job == ""
        assert item.tn == ""
        assert item.email == ""
        assert item.is_department is True
        assert item.roles == []


class TestUserSearchResult:

    def test_minimal(self):
        result = UserSearchResult(username="22501010")
        assert result.fullname == ""
        assert result.job == ""
        assert result.email == ""

    def test_full(self):
        result = UserSearchResult(
            username="22501010",
            fullname="Захарова Мария Дмитриевна",
            job="Старший аудитор",
            email="MDZakharova@omega.sbrf.ru",
        )
        assert result.username == "22501010"


class TestRoleAssignRequest:

    def test_valid(self):
        req = RoleAssignRequest(role_id=1)
        assert req.role_id == 1

    def test_missing_role_id(self):
        with pytest.raises(ValidationError):
            RoleAssignRequest()
