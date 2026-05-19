"""Тест парсинга ClientActionBlock из handler'ов action-tools."""
import json

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
    """Хелпер: вызов парсера с детерминированным message_id и счётчиком."""
    return _orch()._parse_client_action_result(
        raw,
        message_id="msg-test",
        ca_counter=[0],
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
    # block_id должен быть переписан детерминированно
    assert obj["block_id"] == "msg-test:ca:0"


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
    """ca_counter должен увеличиваться между вызовами на одном message_id."""
    orch = _orch()
    counter = [0]
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "x"},
    })
    a = orch._parse_client_action_result(
        raw, message_id="m1", ca_counter=counter,
    )
    b = orch._parse_client_action_result(
        raw, message_id="m1", ca_counter=counter,
    )
    assert a["block_id"] == "m1:ca:0"
    assert b["block_id"] == "m1:ca:1"
    assert counter[0] == 2


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
        raw, message_id="m2", ca_counter=[0],
    )
    assert result is not None
    assert result[0]["type"] == "text"
    assert result[1]["block_id"] == "m2:ca:0"
    assert result[2]["block_id"] == "m2:ca:1"
