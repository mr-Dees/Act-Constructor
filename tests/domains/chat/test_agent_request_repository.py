"""Тесты репозитория agent_requests (mock_conn)."""
import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.agent_request_repository import (
    AgentRequestRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


def _rid() -> str:
    return str(uuid.uuid4())


async def test_create_inserts_row_with_jsonb_fields(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    rid = _rid()
    await repo.create(
        id=rid,
        conversation_id="conv-1",
        message_id="msg-1",
        user_id="u",
        domain_name="acts",
        knowledge_bases=["acts_default"],
        last_user_message="Hello",
        history=[{"role": "user", "content": "Hello"}],
        files=[],
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "agent_requests" in sql
    # id, conversation_id, message_id, user_id, domain_name, knowledge_bases,
    # last_user_message, history, files — 9 параметров
    assert len(params) == 9
    assert params[0] == rid
    assert params[1] == "conv-1"
    # knowledge_bases / history / files передаются как JSON-строки
    assert json.loads(params[5]) == ["acts_default"]
    assert json.loads(params[7]) == [{"role": "user", "content": "Hello"}]
    assert json.loads(params[8]) == []


async def test_get_returns_parsed_jsonb_or_none(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchrow.return_value = {
        "id": "r1", "conversation_id": "c1", "message_id": "m1",
        "user_id": "u", "domain_name": "acts",
        "knowledge_bases": '["acts_default"]',
        "last_user_message": "Hello",
        "history": '[{"role":"user","content":"Hi"}]',
        "files": "[]",
        "status": "pending",
        "error_message": None,
        "created_at": None, "started_at": None, "finished_at": None,
    }
    row = await repo.get("r1")
    assert row is not None
    assert row["knowledge_bases"] == ["acts_default"]
    assert row["history"] == [{"role": "user", "content": "Hi"}]
    assert row["files"] == []
    assert row["status"] == "pending"


async def test_get_returns_none_when_missing(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await repo.get("missing") is None


async def test_update_status_in_progress_sets_started_at(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    await repo.update_status("r1", status="in_progress")
    mock_conn.execute.assert_called_once()
    sql = mock_conn.execute.call_args.args[0]
    assert "UPDATE" in sql
    assert "started_at" in sql
    assert "status" in sql


async def test_update_status_done_sets_finished_at(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    await repo.update_status("r1", status="done")
    sql = mock_conn.execute.call_args.args[0]
    assert "finished_at" in sql
    assert "status" in sql


async def test_update_status_error_stores_message(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    await repo.update_status("r1", status="error", error_message="boom")
    args = mock_conn.execute.call_args.args
    sql = args[0]
    assert "finished_at" in sql
    assert "error_message" in sql
    assert "boom" in args
