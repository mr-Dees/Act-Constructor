"""Тесты AgentBridgeService — send/poll (mock_conn)."""
from unittest.mock import patch

import pytest

from app.domains.chat.services.agent_bridge import (
    AgentBridgeService,
    AgentBridgeTimeout,
    AgentBridgeUpdate,
)


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


async def test_wait_for_completion_yields_events_then_response(mock_conn):
    """Базовый поток: пришли события → пришёл финальный ответ → return."""
    svc = AgentBridgeService(mock_conn)

    # Поведение по очереди: на первый poll_events — пусто, на второй — 2 события;
    # на первый poll_response — None, на второй — финал.
    events_seq = [
        [],
        [
            {"id": 1, "request_id": "r1", "seq": 1, "event_type": "reasoning",
             "payload": '{"text":"a"}', "created_at": None},
            {"id": 2, "request_id": "r1", "seq": 2, "event_type": "reasoning",
             "payload": '{"text":"b"}', "created_at": None},
        ],
    ]
    response_seq = [None, {
        "id": "resp-1", "request_id": "r1",
        "blocks": '[{"type":"text","text":"done"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": "imitated", "created_at": None,
    }]
    mock_conn.fetch.side_effect = events_seq
    mock_conn.fetchrow.side_effect = response_seq

    updates = []
    async for upd in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, timeout_sec=2.0,
    ):
        updates.append(upd)

    # 2 события + 1 финальный ответ
    event_updates = [u for u in updates if u.event is not None]
    response_updates = [u for u in updates if u.response is not None]
    assert len(event_updates) == 2
    assert len(response_updates) == 1
    assert response_updates[0].response["blocks"] == [{"type": "text", "text": "done"}]

    # После финала — UPDATE status='done'
    update_calls = [
        c for c in mock_conn.execute.call_args_list
        if "UPDATE" in c.args[0] and "status" in c.args[0]
    ]
    assert any("done" in str(c.args) for c in update_calls)


async def test_wait_for_completion_advances_cursor_with_last_event_id(mock_conn):
    """Между итерациями courseur (since_id) обновляется до id последнего события."""
    svc = AgentBridgeService(mock_conn)

    mock_conn.fetch.side_effect = [
        [{"id": 5, "request_id": "r1", "seq": 1, "event_type": "reasoning",
          "payload": "{}", "created_at": None}],
        [{"id": 7, "request_id": "r1", "seq": 2, "event_type": "reasoning",
          "payload": "{}", "created_at": None}],
        [],
    ]
    mock_conn.fetchrow.side_effect = [None, None, {
        "id": "x", "request_id": "r1", "blocks": "[]",
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }]

    async for _ in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, timeout_sec=2.0,
    ):
        pass

    # poll_events вызывался 3 раза с since_id: None → 5 → 7
    fetch_calls = mock_conn.fetch.call_args_list
    assert len(fetch_calls) == 3
    # Первый вызов: WHERE request_id = $1 (без id > $2)
    assert "id > $2" not in fetch_calls[0].args[0]
    # Второй и третий: WHERE request_id = $1 AND id > $2, с правильным since_id
    assert "id > $2" in fetch_calls[1].args[0]
    assert fetch_calls[1].args[2] == 5
    assert fetch_calls[2].args[2] == 7


async def test_wait_for_completion_raises_timeout_and_marks_request(mock_conn):
    """Если ничего не приходит за timeout_sec — статус 'timeout' + raise."""
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = None

    with pytest.raises(AgentBridgeTimeout):
        async for _ in svc.wait_for_completion(
            "r1", poll_interval_sec=0.01, timeout_sec=0.05,
        ):
            pass

    # Должен быть UPDATE status='timeout' с error_message
    timeout_updates = [
        c for c in mock_conn.execute.call_args_list
        if "UPDATE" in c.args[0] and "timeout" in str(c.args)
    ]
    assert timeout_updates, "Не нашли UPDATE status='timeout'"


async def test_wait_for_completion_yields_response_even_without_events(mock_conn):
    """Ответ может прийти на первой итерации без промежуточных событий."""
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = {
        "id": "x", "request_id": "r1",
        "blocks": '[{"type":"text","text":"hi"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }

    updates = []
    async for upd in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, timeout_sec=1.0,
    ):
        updates.append(upd)

    assert len(updates) == 1
    assert updates[0].response is not None
    assert updates[0].event is None
