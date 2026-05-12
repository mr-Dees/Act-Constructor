"""Тесты action-tool handler'ов."""
import json
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

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


def _patch_get_db(mock_conn):
    """Контекст-менеджер для патчинга get_db и get_adapter в одном месте."""
    @asynccontextmanager
    async def _fake_get_db():
        yield mock_conn
    fake_adapter = MagicMock()
    fake_adapter.get_table_name = lambda name: name
    return patch.multiple(
        "app.db.connection",
        get_db=_fake_get_db,
        get_adapter=lambda: fake_adapter,
    )


async def test_open_act_page_no_params_returns_text(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    with _patch_get_db(mock_conn):
        raw = await open_act_page_handler()
    # Возвращает обычный текст (не ClientActionBlock)
    assert "не указан" in raw.lower() or "укажите" in raw.lower()


async def test_open_act_page_single_match_by_km_returns_client_action(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = [
        {"id": 42, "km_number": "КМ-12-32141",
         "service_note": "100/2024", "part_number": 1},
    ]
    with _patch_get_db(mock_conn):
        raw = await open_act_page_handler(km_number="КМ-12-32141")
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "open_url"
    assert block["params"]["url"] == "/constructor?act_id=42"
    assert "КМ-12-32141" in block["label"]


async def test_open_act_page_single_match_by_sz_returns_client_action(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = [
        {"id": 17, "km_number": "КМ-12-32141",
         "service_note": "100/2024", "part_number": 1},
    ]
    with _patch_get_db(mock_conn):
        raw = await open_act_page_handler(sz_number="100/2024")
    block = json.loads(raw)
    assert block["params"]["url"] == "/constructor?act_id=17"


async def test_open_act_page_multiple_matches_asks_clarification(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = [
        {"id": 42, "km_number": "КМ-12-32141",
         "service_note": "100/2024", "part_number": 1},
        {"id": 43, "km_number": "КМ-12-32141",
         "service_note": "105/2024", "part_number": 2},
    ]
    with _patch_get_db(mock_conn):
        raw = await open_act_page_handler(km_number="КМ-12-32141")
    # Не JSON ClientActionBlock — обычный текст со списком
    assert not raw.startswith("{")
    assert "100/2024" in raw
    assert "105/2024" in raw
    assert "уточните" in raw.lower() or "уточнить" in raw.lower()


async def test_open_act_page_no_match_returns_not_found_text(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = []
    with _patch_get_db(mock_conn):
        raw = await open_act_page_handler(km_number="КМ-99-99999")
    assert not raw.startswith("{")
    assert "не найден" in raw.lower()


async def test_open_act_page_query_by_km_uses_km_number_digit(mock_conn):
    """Поиск по КМ должен использовать km_number_digit (быстрый INTEGER-ключ)."""
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = []
    with _patch_get_db(mock_conn):
        await open_act_page_handler(km_number="КМ-12-32141")
    sql = mock_conn.fetch.call_args.args[0]
    assert "km_number_digit" in sql


async def test_open_act_page_query_by_sz_uses_service_note(mock_conn):
    from app.domains.acts.integrations.action_handlers import open_act_page_handler
    mock_conn.fetch.return_value = []
    with _patch_get_db(mock_conn):
        await open_act_page_handler(sz_number="100/2024")
    sql = mock_conn.fetch.call_args.args[0]
    assert "service_note" in sql
