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


# ── per-domain open_*_page handlers ──


async def test_admin_open_admin_panel_emits_client_action():
    from app.domains.admin.integrations.action_handlers import (
        open_admin_panel_handler,
    )
    raw = await open_admin_panel_handler()
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "open_url"
    assert block["params"]["url"] == "/admin"
    assert block["label"] == "Администрирование"


async def test_ck_fin_res_open_page_emits_client_action():
    from app.domains.ck_fin_res.integrations.action_handlers import (
        open_ck_fin_res_page_handler,
    )
    raw = await open_ck_fin_res_page_handler()
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "open_url"
    assert block["params"]["url"] == "/ck-fin-res"
    assert block["label"] == "ЦК Фин.Рез."


async def test_ck_client_exp_open_page_emits_client_action():
    from app.domains.ck_client_exp.integrations.action_handlers import (
        open_ck_client_exp_page_handler,
    )
    raw = await open_ck_client_exp_page_handler()
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "open_url"
    assert block["params"]["url"] == "/ck-client-experience"
    assert block["label"] == "ЦК Клиентский опыт"


# ── chat.list_pages ──


async def test_list_pages_emits_buttons_with_all_nav_items():
    """Handler chat.list_pages возвращает buttons-блок для всех NavItem доменов."""
    from app.core import domain_registry as dr
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.chat.integrations.list_pages_handler import (
        list_pages_handler,
    )

    dr.reset_registry()
    try:
        dr._domains.append(DomainDescriptor(
            name="d1",
            nav_items=[NavItem(label="Стр A", url="/a", icon_svg="<svg/>")],
        ))
        dr._domains.append(DomainDescriptor(
            name="d2",
            nav_items=[NavItem(label="Стр B", url="/b", icon_svg="<svg/>")],
        ))

        raw = await list_pages_handler()
        block = json.loads(raw)

        assert block["type"] == "buttons"
        assert isinstance(block["buttons"], list)
        assert len(block["buttons"]) == 2
        for btn in block["buttons"]:
            assert btn["action_id"] == "open_url"
            assert "url" in btn["params"]
        urls = {b["params"]["url"] for b in block["buttons"]}
        assert urls == {"/a", "/b"}
    finally:
        dr.reset_registry()
