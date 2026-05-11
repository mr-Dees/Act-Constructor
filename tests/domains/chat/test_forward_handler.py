"""Тесты forward_to_knowledge_agent handler-фабрики."""
import re
import uuid
from unittest.mock import patch

import pytest

from app.domains.chat.integrations.forward_handler import (
    FORWARD_SENTINEL_PATTERN,
    build_forward_handler,
    make_forward_sentinel,
)


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


def test_sentinel_format_round_trip():
    rid = uuid.uuid4()
    s = make_forward_sentinel(str(rid))
    m = FORWARD_SENTINEL_PATTERN.match(s)
    assert m is not None
    assert m.group("request_id") == str(rid)


def test_sentinel_pattern_rejects_bad_strings():
    assert FORWARD_SENTINEL_PATTERN.match("<<forwarded_request:not-a-uuid>>") is None
    assert FORWARD_SENTINEL_PATTERN.match("forwarded_request:00000000-0000-0000-0000-000000000000") is None
    assert FORWARD_SENTINEL_PATTERN.match("") is None


async def test_handler_inserts_request_and_returns_sentinel(mock_conn):
    handler = build_forward_handler(
        conn=mock_conn,
        conversation_id="conv-1",
        message_id="msg-1",
        user_id="u",
        domain_name="acts",
        knowledge_bases=["acts_default"],
        history=[{"role": "user", "content": "Hello"}],
        files=[],
    )
    result = await handler(question="Что такое КСО?")
    m = FORWARD_SENTINEL_PATTERN.match(result)
    assert m is not None
    rid = m.group("request_id")
    # Должен быть валидный UUID
    uuid.UUID(rid)
    # Должна быть запись в agent_requests
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql and "agent_requests" in sql
    assert params[0] == rid  # id = сгенерированный UUID
    assert params[1] == "conv-1"
    assert params[2] == "msg-1"


async def test_handler_appends_kb_hint_to_knowledge_bases(mock_conn):
    handler = build_forward_handler(
        conn=mock_conn,
        conversation_id="c", message_id="m", user_id="u",
        domain_name=None, knowledge_bases=["base_a"],
        history=[], files=[],
    )
    await handler(question="x", kb_hint="base_b")
    params = mock_conn.execute.call_args.args[1:]
    # 6-й параметр в SQL — knowledge_bases JSON
    import json
    kbs = json.loads(params[5])
    assert set(kbs) == {"base_a", "base_b"}


async def test_handler_does_not_duplicate_kb_hint(mock_conn):
    handler = build_forward_handler(
        conn=mock_conn,
        conversation_id="c", message_id="m", user_id="u",
        domain_name=None, knowledge_bases=["base_a"],
        history=[], files=[],
    )
    await handler(question="x", kb_hint="base_a")
    import json
    kbs = json.loads(mock_conn.execute.call_args.args[1:][5])
    assert kbs == ["base_a"]
