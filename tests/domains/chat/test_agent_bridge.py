"""Тесты AgentBridgeService — send/poll (mock_conn)."""
from unittest.mock import patch

import pytest

from app.domains.chat.services.agent_bridge import AgentBridgeService


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


async def test_send_generates_uuid_and_calls_insert(mock_conn):
    svc = AgentBridgeService(mock_conn)
    rid = await svc.send(
        conversation_id="c1",
        message_id="m1",
        user_id="u",
        domain_name="acts",
        knowledge_bases=["acts_default"],
        last_user_message="Hello",
        history=[{"role": "user", "content": "Hello"}],
        files=[],
    )
    # request_id — строка UUID длиной 36
    assert isinstance(rid, str)
    assert len(rid) == 36

    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql and "agent_requests" in sql
    assert params[0] == rid


async def test_send_returns_distinct_ids_for_repeated_calls(mock_conn):
    svc = AgentBridgeService(mock_conn)
    rid1 = await svc.send(
        conversation_id="c1", message_id="m1", user_id="u",
        domain_name=None, knowledge_bases=[], last_user_message="x",
        history=[], files=[],
    )
    rid2 = await svc.send(
        conversation_id="c1", message_id="m2", user_id="u",
        domain_name=None, knowledge_bases=[], last_user_message="y",
        history=[], files=[],
    )
    assert rid1 != rid2


async def test_poll_events_delegates_to_repo(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = [
        {"id": 1, "request_id": "r1", "seq": 1, "event_type": "reasoning",
         "payload": '{"text":"a"}', "created_at": None},
    ]
    events = await svc.poll_events("r1", since_id=None)
    assert len(events) == 1
    assert events[0]["payload"] == {"text": "a"}


async def test_poll_events_with_cursor_passes_since_to_repo(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    await svc.poll_events("r1", since_id=10)
    sql, *params = mock_conn.fetch.call_args.args
    assert "id > $2" in sql
    assert params == ["r1", 10]


async def test_poll_response_returns_none_when_pending(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await svc.poll_response("r1") is None


async def test_poll_response_returns_dict_when_present(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetchrow.return_value = {
        "id": "resp-1", "request_id": "r1",
        "blocks": '[{"type":"text","text":"ok"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": "imitated", "created_at": None,
    }
    row = await svc.poll_response("r1")
    assert row["blocks"] == [{"type": "text", "text": "ok"}]
    assert row["finish_reason"] == "stop"
