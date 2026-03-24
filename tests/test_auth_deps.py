"""Тесты для get_username — зависимость авторизации."""

import inspect
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.api.v1.deps.auth_deps import get_username


class TestGetUsername:

    @patch("app.api.v1.deps.auth_deps.get_current_user_from_env", return_value="12345678")
    def test_returns_username_from_env(self, mock_env):
        assert get_username() == "12345678"

    @patch("app.api.v1.deps.auth_deps.get_current_user_from_env", return_value=None)
    def test_raises_401_when_no_user(self, mock_env):
        with pytest.raises(HTTPException) as exc_info:
            get_username()
        assert exc_info.value.status_code == 401

    def test_takes_no_parameters(self):
        sig = inspect.signature(get_username)
        assert len(sig.parameters) == 0
