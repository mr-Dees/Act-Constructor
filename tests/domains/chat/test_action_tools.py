"""Тесты action-tool handler'ов."""
import json

from app.domains.chat.integrations.notify_handler import notify_handler


async def test_notify_handler_returns_client_action_json():
    raw = await notify_handler(message="Готово", level="success")
    block = json.loads(raw)
    assert block == {
        "type": "client_action",
        "action": "notify",
        "params": {"message": "Готово", "level": "success"},
        "label": "Готово",
    }


async def test_notify_handler_default_level_info():
    raw = await notify_handler(message="x")
    block = json.loads(raw)
    assert block["params"]["level"] == "info"


async def test_notify_handler_preserves_unicode():
    """ensure_ascii=False должен сохранить русские символы как есть."""
    raw = await notify_handler(message="Привет, мир!")
    assert "Привет, мир!" in raw  # не должно быть \\u04...
