"""Тесты реестра action-кнопок чата."""
import pytest


@pytest.fixture(autouse=True)
def _reset_action_registry():
    from app.core.chat.buttons import reset_action_handlers

    reset_action_handlers()
    yield
    reset_action_handlers()


class TestQuickReplyButton:
    def test_create(self):
        from app.core.chat.blocks import QuickReplyButton

        btn = QuickReplyButton(label="Да", value="Подтверждаю")
        assert btn.label == "Да"
        assert btn.value == "Подтверждаю"


class TestActionButton:
    def test_create(self):
        from app.core.chat.blocks import ActionButton

        btn = ActionButton(id="acts.export", label="Экспорт", domain="acts")
        assert btn.id == "acts.export"
        assert btn.confirm is False

    def test_create_with_confirm(self):
        from app.core.chat.blocks import ActionButton

        btn = ActionButton(
            id="acts.delete",
            label="Удалить",
            domain="acts",
            params={"act_id": 1},
            confirm=True,
        )
        assert btn.confirm is True


class TestActionHandlerRegistry:
    def test_register_and_get(self):
        from app.core.chat.buttons import get_action_handler, register_action_handler

        async def my_handler(**kwargs):
            return {"ok": True}

        register_action_handler("test.action", "test", my_handler, "Тест")
        entry = get_action_handler("test.action")
        assert entry is not None
        assert entry["domain"] == "test"
        assert entry["handler"] is my_handler

    def test_get_nonexistent(self):
        from app.core.chat.buttons import get_action_handler

        assert get_action_handler("nonexistent") is None

    def test_duplicate_raises(self):
        from app.core.chat.buttons import register_action_handler

        async def h(**kw):
            return {}

        register_action_handler("dup.action", "test", h, "Тест")
        with pytest.raises(RuntimeError, match="already registered"):
            register_action_handler("dup.action", "test", h, "Тест")
