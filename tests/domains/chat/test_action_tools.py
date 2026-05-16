"""Тесты action-tool handler'ов."""
import json
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

from app.domains.chat.integrations.notify_handler import notify_handler


async def test_notify_handler_returns_client_action_json():
    raw = await notify_handler(message="Готово", level="success")
    block = json.loads(raw)
    assert block["type"] == "client_action"
    assert block["action"] == "notify"
    assert block["params"] == {"message": "Готово", "level": "success"}
    assert block["label"] == "Готово"
    # block_id обязателен — это идемпотентный uuid для фронта.
    assert block.get("block_id")


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


async def test_list_pages_emits_text_block_with_intro_and_descriptions():
    """Первый блок — text с описанием ассистента и списком разделов."""
    from app.core import domain_registry as dr
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.chat.integrations.list_pages_handler import (
        list_pages_handler,
    )

    dr.reset_registry()
    try:
        dr._domains.append(DomainDescriptor(
            name="d1",
            nav_items=[NavItem(
                label="Стр A", url="/a", icon_svg="<svg/>",
                description="Описание A",
            )],
        ))
        dr._domains.append(DomainDescriptor(
            name="d2",
            nav_items=[NavItem(
                label="Стр B", url="/b", icon_svg="<svg/>",
                description="Описание B",
            )],
        ))
        # NavItem без description — не должен попасть в текстовый список
        dr._domains.append(DomainDescriptor(
            name="d3",
            nav_items=[NavItem(label="Стр C", url="/c", icon_svg="<svg/>")],
        ))

        raw = await list_pages_handler()
        blocks = json.loads(raw)

        assert isinstance(blocks, list)
        assert len(blocks) == 2
        text_block = blocks[0]
        assert text_block["type"] == "text"
        text = text_block["content"]
        # Intro: упоминание ассистента и базы знаний
        assert "ассистент" in text.lower() or "audit workstation" in text.lower()
        # Список разделов: label + description присутствуют
        assert "Стр A" in text
        assert "Описание A" in text
        assert "Стр B" in text
        assert "Описание B" in text
        # Без description — в текст не попадает
        assert "Стр C" not in text
        # Спец-возможности
        assert "КМ" in text  # упоминание КМ-номера
    finally:
        dr.reset_registry()


async def test_list_pages_emits_buttons_after_text():
    """Второй блок — buttons со всеми NavItem (включая те, что без description)."""
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
        blocks = json.loads(raw)

        assert blocks[0]["type"] == "text"
        buttons_block = blocks[1]
        assert buttons_block["type"] == "buttons"
        assert isinstance(buttons_block["buttons"], list)
        for btn in buttons_block["buttons"]:
            assert btn["action_id"] == "open_url"
            assert "url" in btn["params"]
        urls = {b["params"]["url"] for b in buttons_block["buttons"]}
        # Кнопки доменов + статическая Админ-панель (всегда первой)
        assert {"/a", "/b", "/admin"}.issubset(urls)
    finally:
        dr.reset_registry()


# ── button translators ──


async def test_button_translator_acts_open_act_page_resolves_valid_km(mock_conn):
    from app.domains.acts.integrations.action_handlers import (
        open_act_page_button_translator,
    )
    mock_conn.fetch.return_value = [
        {"id": 42, "km_number": "КМ-12-32141",
         "service_note": "100/2024", "part_number": 1},
    ]
    with _patch_get_db(mock_conn):
        translated = await open_act_page_button_translator(
            {"km_number": "КМ-12-32141"},
        )
    assert translated == {
        "action": "open_url",
        "params": {"url": "/constructor?act_id=42"},
    }


async def test_button_translator_acts_open_act_page_handles_missing(mock_conn):
    from app.domains.acts.integrations.action_handlers import (
        open_act_page_button_translator,
    )
    mock_conn.fetch.return_value = []
    with _patch_get_db(mock_conn):
        translated = await open_act_page_button_translator(
            {"km_number": "КМ-99-99999"},
        )
    assert translated["action"] == "notify"
    assert translated["params"]["level"] == "error"
    assert "КМ-99-99999" in translated["params"]["message"]
    assert "не найден" in translated["params"]["message"].lower()


async def test_button_translator_acts_open_act_page_handles_multiple_matches(mock_conn):
    """Если КМ найден в нескольких частях — translator считает это «не найдено»."""
    from app.domains.acts.integrations.action_handlers import (
        open_act_page_button_translator,
    )
    mock_conn.fetch.return_value = [
        {"id": 42, "km_number": "КМ-12-32141",
         "service_note": "100/2024", "part_number": 1},
        {"id": 43, "km_number": "КМ-12-32141",
         "service_note": "105/2024", "part_number": 2},
    ]
    with _patch_get_db(mock_conn):
        translated = await open_act_page_button_translator(
            {"km_number": "КМ-12-32141"},
        )
    assert translated["action"] == "notify"
    assert translated["params"]["level"] == "error"
