"""Тесты для settings_registry и AuditIdService."""

import pytest
from pydantic import BaseModel

from app.core import settings_registry


@pytest.fixture(autouse=True)
def clean_registry():
    settings_registry.reset()
    yield
    settings_registry.reset()


# ── settings_registry ──


class TestSettingsRegistry:

    def test_get_unregistered_raises(self):
        with pytest.raises(KeyError, match="не зарегистрированы"):
            settings_registry.get("missing")

    def test_reset_clears(self):
        # Регистрируем простую модель напрямую в _registry для unit-теста
        class Dummy(BaseModel):
            x: int = 1

        settings_registry._registry["dummy"] = Dummy()
        settings_registry.reset()
        with pytest.raises(KeyError):
            settings_registry.get("dummy")

    def test_get_with_wrong_type_raises(self):
        class ModelA(BaseModel):
            a: int = 1

        class ModelB(BaseModel):
            b: int = 2

        settings_registry._registry["test"] = ModelA()
        with pytest.raises(TypeError, match="ожидался"):
            settings_registry.get("test", ModelB)

    def test_get_with_correct_type(self):
        class MyModel(BaseModel):
            val: int = 42

        instance = MyModel()
        settings_registry._registry["test"] = instance
        result = settings_registry.get("test", MyModel)
        assert result.val == 42

    def test_get_without_type_check(self):
        class MyModel(BaseModel):
            val: int = 99

        settings_registry._registry["test"] = MyModel()
        result = settings_registry.get("test")
        assert result.val == 99


# ── AuditIdService ──


class TestAuditIdService:
    # AuditIdService — пока заглушка (str(uuid4())). Тесты формата/уникальности
    # uuid были бы проверкой стдлиба, поэтому держим только контракт пустого входа.

    async def test_generate_audit_point_ids_empty(self):
        from app.services.audit_id_service import AuditIdService

        result = await AuditIdService.generate_audit_point_ids([])
        assert result == {}
