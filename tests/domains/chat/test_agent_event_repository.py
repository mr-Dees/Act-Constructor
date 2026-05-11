"""Тесты репозитория agent_response_events (mock_conn)."""
import json
from unittest.mock import patch

import pytest

from app.domains.chat.repositories.agent_event_repository import (
    AgentEventRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


async def test_append_inserts_with_seq_and_jsonb_payload(mock_conn):
    repo = AgentEventRepository(mock_conn)
    mock_conn.fetchval.return_value = 42

    new_id = await repo.append(
        request_id="r1", seq=3, event_type="reasoning",
        payload={"text": "хм"},
    )
    assert new_id == 42

    mock_conn.fetchval.assert_called_once()
    sql, *params = mock_conn.fetchval.call_args.args
    assert "INSERT INTO" in sql
    assert "agent_response_events" in sql
    assert "RETURNING id" in sql
    assert params == ["r1", 3, "reasoning", json.dumps({"text": "хм"}, ensure_ascii=False)]


async def test_poll_without_since_returns_all_in_order(mock_conn):
    repo = AgentEventRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {"id": 1, "request_id": "r1", "seq": 1, "event_type": "reasoning",
         "payload": '{"text":"a"}', "created_at": None},
        {"id": 2, "request_id": "r1", "seq": 2, "event_type": "reasoning",
         "payload": '{"text":"b"}', "created_at": None},
    ]
    events = await repo.poll("r1", since_id=None)
    assert [e["id"] for e in events] == [1, 2]
    assert events[0]["payload"] == {"text": "a"}
    sql = mock_conn.fetch.call_args.args[0]
    assert "WHERE request_id = $1" in sql
    assert "ORDER BY id" in sql
    # since_id отсутствует — не должно быть "id > $2"
    assert "id > $2" not in sql


async def test_poll_with_since_filters_and_uses_cursor(mock_conn):
    repo = AgentEventRepository(mock_conn)
    mock_conn.fetch.return_value = []
    await repo.poll("r1", since_id=10)
    sql, *params = mock_conn.fetch.call_args.args
    assert "id > $2" in sql
    assert params == ["r1", 10]


async def test_poll_returns_empty_when_no_rows(mock_conn):
    repo = AgentEventRepository(mock_conn)
    mock_conn.fetch.return_value = []
    assert await repo.poll("r1", since_id=None) == []


async def test_payload_already_dict_is_passed_through(mock_conn):
    """Если payload пришёл уже dict (некоторые драйверы возвращают так) — не парсить повторно."""
    repo = AgentEventRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {"id": 1, "request_id": "r1", "seq": 1, "event_type": "status",
         "payload": {"stage": "search"}, "created_at": None},
    ]
    events = await repo.poll("r1", since_id=None)
    assert events[0]["payload"] == {"stage": "search"}
