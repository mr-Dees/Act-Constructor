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


def test_parse_client_action_result_recognizes_block():
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "Готово"},
        "label": "Готово",
    })
    obj = _orch()._parse_client_action_result(raw)
    assert obj is not None
    assert obj["action"] == "notify"


def test_parse_client_action_result_ignores_plain_text():
    assert _orch()._parse_client_action_result("plain string") is None


def test_parse_client_action_result_ignores_json_without_type():
    raw = json.dumps({"action": "notify"})
    assert _orch()._parse_client_action_result(raw) is None


def test_parse_client_action_result_ignores_other_block_types():
    raw = json.dumps({"type": "text", "content": "hi"})
    assert _orch()._parse_client_action_result(raw) is None


def test_parse_client_action_result_ignores_invalid_json():
    assert _orch()._parse_client_action_result("not json {") is None
