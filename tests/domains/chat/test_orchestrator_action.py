"""Тест парсинга ClientActionBlock из handler'ов action-tools."""
import json

from app.core.chat.block_id_generator import BlockIdGenerator
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.settings import ChatDomainSettings


def _orch() -> Orchestrator:
    from unittest.mock import AsyncMock
    return Orchestrator(
        msg_service=AsyncMock(),
        conv_service=AsyncMock(),
        settings=ChatDomainSettings(),
    )


def _parse(raw: str):
    """Хелпер: вызов парсера с детерминированным генератором block_id."""
    return _orch()._parse_client_action_result(
        raw,
        block_id_gen=BlockIdGenerator(message_id="msg-test"),
    )


def test_parse_client_action_result_recognizes_block():
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "Готово"},
        "label": "Готово",
    })
    obj = _parse(raw)
    assert obj is not None
    assert obj["action"] == "notify"
    # block_id должен быть переписан детерминированно через генератор
    assert obj["block_id"] == "msg-test:client_action:0"


def test_parse_client_action_result_ignores_plain_text():
    assert _parse("plain string") is None


def test_parse_client_action_result_ignores_json_without_type():
    raw = json.dumps({"action": "notify"})
    assert _parse(raw) is None


def test_parse_client_action_result_ignores_other_block_types():
    raw = json.dumps({"type": "text", "content": "hi"})
    assert _parse(raw) is None


def test_parse_client_action_result_ignores_invalid_json():
    assert _parse("not json {") is None


def test_parse_client_action_result_counter_increments():
    """Генератор должен инкрементить per-type счётчик между вызовами."""
    orch = _orch()
    gen = BlockIdGenerator(message_id="m1")
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "x"},
    })
    a = orch._parse_client_action_result(raw, block_id_gen=gen)
    b = orch._parse_client_action_result(raw, block_id_gen=gen)
    assert a["block_id"] == "m1:client_action:0"
    assert b["block_id"] == "m1:client_action:1"


def test_parse_blocks_list_result_rewrites_client_action_ids():
    """В списке блоков client_action получают детерминированный block_id."""
    raw = json.dumps([
        {"type": "text", "content": "intro"},
        {
            "type": "client_action",
            "action": "open_url",
            "params": {"url": "https://example.com"},
        },
        {
            "type": "client_action",
            "action": "notify",
            "params": {"message": "x"},
        },
    ])
    orch = _orch()
    result = orch._parse_blocks_list_result(
        raw, block_id_gen=BlockIdGenerator(message_id="m2"),
    )
    assert result is not None
    assert result[0]["type"] == "text"
    assert result[1]["block_id"] == "m2:client_action:0"
    assert result[2]["block_id"] == "m2:client_action:1"
