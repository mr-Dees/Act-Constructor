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

    async def test_generate_audit_act_id_returns_uuid(self):
        from app.services.audit_id_service import AuditIdService

        result = await AuditIdService.generate_audit_act_id()
        assert isinstance(result, str)
        assert len(result) == 36  # UUID v4 format
        assert result.count("-") == 4

    async def test_generate_audit_point_ids_batch(self):
        from app.services.audit_id_service import AuditIdService

        node_ids = ["n1", "n2", "n3"]
        result = await AuditIdService.generate_audit_point_ids(node_ids)
        assert set(result.keys()) == {"n1", "n2", "n3"}
        assert all(len(v) == 36 for v in result.values())

    async def test_generate_audit_point_ids_empty(self):
        from app.services.audit_id_service import AuditIdService

        result = await AuditIdService.generate_audit_point_ids([])
        assert result == {}

    async def test_ids_are_unique(self):
        from app.services.audit_id_service import AuditIdService

        ids = [await AuditIdService.generate_audit_act_id() for _ in range(10)]
        assert len(set(ids)) == 10
