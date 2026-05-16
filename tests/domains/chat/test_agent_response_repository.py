"""Тесты репозитория agent_responses (mock_conn)."""
import json
from unittest.mock import patch

import pytest

from app.domains.chat.repositories.agent_response_repository import (
    AgentResponseRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


async def test_insert_writes_jsonb_blocks_and_token_usage(mock_conn):
    repo = AgentResponseRepository(mock_conn)
    await repo.insert(
        id="resp-1",
        request_id="req-1",
        blocks=[{"type": "text", "content": "Привет"}],
        finish_reason="stop",
        token_usage={"prompt_tokens": 10, "completion_tokens": 5},
        model="imitated",
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "agent_responses" in sql
    # id, request_id, blocks, finish_reason, token_usage, model
    assert len(params) == 6
    assert params[0] == "resp-1"
    assert params[1] == "req-1"
    assert json.loads(params[2]) == [{"type": "text", "content": "Привет"}]
    assert params[3] == "stop"
    assert json.loads(params[4]) == {"prompt_tokens": 10, "completion_tokens": 5}
    assert params[5] == "imitated"


async def test_insert_handles_null_token_usage(mock_conn):
    repo = AgentResponseRepository(mock_conn)
    await repo.insert(
        id="resp-1", request_id="req-1",
        blocks=[{"type": "text", "content": "x"}],
        finish_reason="stop", token_usage=None, model=None,
    )
    params = mock_conn.execute.call_args.args[1:]
    assert params[4] is None  # token_usage
    assert params[5] is None  # model


async def test_get_by_request_id_parses_jsonb(mock_conn):
    repo = AgentResponseRepository(mock_conn)
    mock_conn.fetchrow.return_value = {
        "id": "resp-1", "request_id": "req-1",
        "blocks": '[{"type":"text","content":"Hi"}]',
        "finish_reason": "stop",
        "token_usage": '{"prompt_tokens":12}',
        "model": "m", "created_at": None,
    }
    row = await repo.get_by_request_id("req-1")
    assert row is not None
    assert row["blocks"] == [{"type": "text", "content": "Hi"}]
    assert row["token_usage"] == {"prompt_tokens": 12}


async def test_get_by_request_id_returns_none_when_absent(mock_conn):
    repo = AgentResponseRepository(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await repo.get_by_request_id("nope") is None


async def test_insert_idempotent_on_unique_violation(mock_conn):
    """1.7: Повторный INSERT для того же request_id не падает,
    а возвращает уже существующую запись.
    """
    import asyncpg
    repo = AgentResponseRepository(mock_conn)

    # Первый вызов: успешный INSERT (без SELECT). Возвращается dict с
    # переданными значениями.
    first = await repo.insert(
        id="resp-orig",
        request_id="req-1",
        blocks=[{"type": "text", "content": "orig"}],
    )
    assert first["id"] == "resp-orig"
    assert first["request_id"] == "req-1"

    # Второй вызов: INSERT падает с UniqueViolation, SELECT возвращает
    # уже сохранённую первую запись.
    mock_conn.execute.side_effect = asyncpg.UniqueViolationError(
        "duplicate key",
    )
    mock_conn.fetchrow.return_value = {
        "id": "resp-orig",
        "request_id": "req-1",
        "blocks": '[{"type":"text","content":"orig"}]',
        "finish_reason": "stop",
        "token_usage": None,
        "model": "m",
        "created_at": None,
    }
    second = await repo.insert(
        id="resp-dup",
        request_id="req-1",
        blocks=[{"type": "text", "content": "duplicate attempt"}],
    )
    assert second["id"] == "resp-orig"
    assert second["request_id"] == "req-1"


async def test_insert_propagates_when_unique_conflict_and_no_existing(mock_conn):
    """1.7: Если после UNIQUE-конфликта запись внезапно исчезла (гонка с DELETE),
    исключение пробрасывается наружу — это нештатная ситуация.
    """
    import asyncpg
    repo = AgentResponseRepository(mock_conn)
    mock_conn.execute.side_effect = asyncpg.UniqueViolationError("duplicate")
    mock_conn.fetchrow.return_value = None

    with pytest.raises(asyncpg.UniqueViolationError):
        await repo.insert(
            id="x",
            request_id="ghost",
            blocks=[],
        )
