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


async def test_open_act_page_handler_returns_open_url_block():
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    raw = await open_act_page_handler(km_number="КМ-23-00001")
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "open_url"
    # URL должен заканчиваться номером акта (URL-encoded для Cyrillic ОК)
    assert block["params"]["url"].endswith("00001") or "КМ-23-00001" in block["params"]["url"]
    assert "Открываю" in block["label"]
    assert "КМ-23-00001" in block["label"]
