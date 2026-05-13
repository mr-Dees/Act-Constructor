"""Тесты AgentBridgeService — send/poll (mock_conn)."""
import asyncio
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


# Дефолтные значения трёх гейтов для тестов, не проверяющих сами гейты.
# Достаточно большие, чтобы гейт не сработал в ходе быстрого теста.
_LARGE_GATE_KWARGS = dict(
    initial_response_timeout_sec=10,
    event_timeout_sec=10,
    max_total_duration_sec=10,
)


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
    events = await svc.poll_events("r1", since_seq=None)
    assert len(events) == 1
    assert events[0]["payload"] == {"text": "a"}


async def test_poll_events_with_cursor_passes_since_to_repo(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    await svc.poll_events("r1", since_seq=10)
    sql, *params = mock_conn.fetch.call_args.args
    assert "seq > $2" in sql
    assert params == ["r1", 10]


async def test_poll_response_returns_none_when_pending(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await svc.poll_response("r1") is None


async def test_poll_response_returns_dict_when_present(mock_conn):
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetchrow.return_value = {
        "id": "resp-1", "request_id": "r1",
        "blocks": '[{"type":"text","content":"ok"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": "imitated", "created_at": None,
    }
    row = await svc.poll_response("r1")
    assert row["blocks"] == [{"type": "text", "content": "ok"}]
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
        "blocks": '[{"type":"text","content":"done"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": "imitated", "created_at": None,
    }]
    mock_conn.fetch.side_effect = events_seq
    mock_conn.fetchrow.side_effect = response_seq

    updates = []
    async for upd in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, **_LARGE_GATE_KWARGS,
    ):
        updates.append(upd)

    # 2 события + 1 финальный ответ
    event_updates = [u for u in updates if u.event is not None]
    response_updates = [u for u in updates if u.response is not None]
    assert len(event_updates) == 2
    assert len(response_updates) == 1
    assert response_updates[0].response["blocks"] == [{"type": "text", "content": "done"}]

    # После финала — UPDATE status='done'
    update_calls = [
        c for c in mock_conn.execute.call_args_list
        if "UPDATE" in c.args[0] and "status" in c.args[0]
    ]
    assert any("done" in str(c.args) for c in update_calls)


async def test_wait_for_completion_advances_cursor_with_last_event_seq(mock_conn):
    """Между итерациями courseur (since_seq) обновляется до seq последнего события.

    Курсор именно по seq, не по id — id в GP не монотонен между сегментами
    distributed-таблицы.
    """
    svc = AgentBridgeService(mock_conn)

    mock_conn.fetch.side_effect = [
        [{"id": 5, "request_id": "r1", "seq": 3, "event_type": "reasoning",
          "payload": "{}", "created_at": None}],
        [{"id": 7, "request_id": "r1", "seq": 4, "event_type": "reasoning",
          "payload": "{}", "created_at": None}],
        [],
    ]
    mock_conn.fetchrow.side_effect = [None, None, {
        "id": "x", "request_id": "r1", "blocks": "[]",
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }]

    async for _ in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, **_LARGE_GATE_KWARGS,
    ):
        pass

    # poll_events вызывался 3 раза с курсором по seq: None → 3 → 4
    fetch_calls = mock_conn.fetch.call_args_list
    assert len(fetch_calls) == 3
    # Первый вызов: WHERE request_id = $1 (без seq > $2)
    assert "seq > $2" not in fetch_calls[0].args[0]
    # Второй и третий: WHERE request_id = $1 AND seq > $2, с правильным seq
    assert "seq > $2" in fetch_calls[1].args[0]
    assert fetch_calls[1].args[2] == 3
    assert fetch_calls[2].args[2] == 4


async def test_wait_for_completion_yields_response_even_without_events(mock_conn):
    """Ответ может прийти на первой итерации без промежуточных событий."""
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = {
        "id": "x", "request_id": "r1",
        "blocks": '[{"type":"text","content":"hi"}]',
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }

    updates = []
    async for upd in svc.wait_for_completion(
        "r1", poll_interval_sec=0.0, **_LARGE_GATE_KWARGS,
    ):
        updates.append(upd)

    assert len(updates) == 1
    assert updates[0].response is not None
    assert updates[0].event is None


# === Тесты трёх гейтов таймаута ===

def _timeout_update_calls(mock_conn):
    """Возвращает все UPDATE-вызовы, маркирующие запрос как timeout."""
    return [
        c for c in mock_conn.execute.call_args_list
        if "UPDATE" in c.args[0] and "timeout" in str(c.args)
    ]


async def test_initial_response_gate_fires_when_no_events(mock_conn):
    """Гейт 1: если за initial_response_timeout_sec не пришло ни одного события —
    timeout с message 'не начал отвечать'."""
    svc = AgentBridgeService(mock_conn)
    mock_conn.fetch.return_value = []
    mock_conn.fetchrow.return_value = None

    with pytest.raises(AgentBridgeTimeout) as exc_info:
        async for _ in svc.wait_for_completion(
            "r1",
            poll_interval_sec=0.05,
            initial_response_timeout_sec=0.3,
            event_timeout_sec=10,
            max_total_duration_sec=10,
        ):
            pass

    assert "no initial response" in str(exc_info.value)
    timeout_calls = _timeout_update_calls(mock_conn)
    assert timeout_calls, "Не нашли UPDATE status='timeout'"
    # error_message должен упоминать «не начал отвечать»
    assert any("не начал отвечать" in str(c.args) for c in timeout_calls)


async def test_initial_response_gate_disarmed_after_first_event(mock_conn):
    """Гейт 1 разоружается первым же событием: даже если elapsed > initial,
    initial-гейт уже не сработает."""
    svc = AgentBridgeService(mock_conn)

    # Первый poll_events возвращает событие, далее — пусто (но heartbeat=10с).
    event = {
        "id": 1, "request_id": "r1", "seq": 1, "event_type": "reasoning",
        "payload": "{}", "created_at": None,
    }
    # Финальный ответ выдаём через ~3 итерации, чтобы гейт точно успел "пройти".
    mock_conn.fetch.side_effect = [[event]] + [[]] * 100
    final = {
        "id": "x", "request_id": "r1", "blocks": "[]",
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }
    # None на первой итерации (после события), затем после задержки — финал.
    response_responses = [None] * 5 + [final]
    mock_conn.fetchrow.side_effect = response_responses

    # initial=0.3с — заведомо меньше суммарного времени теста.
    # event_timeout=10с — heartbeat не сработает между пустыми итерациями.
    # max=10с — тоже большой, не сработает.
    started = asyncio.get_event_loop().time()
    updates = []
    async for upd in svc.wait_for_completion(
        "r1",
        poll_interval_sec=0.1,
        initial_response_timeout_sec=0.3,
        event_timeout_sec=10,
        max_total_duration_sec=10,
    ):
        updates.append(upd)
    elapsed = asyncio.get_event_loop().time() - started

    # Гейт-1 не должен был сработать — никакого AgentBridgeTimeout.
    assert not _timeout_update_calls(mock_conn)
    # Цикл крутился дольше initial_response_timeout_sec — это и есть проверка
    # «гейт разоружен после первого события».
    assert elapsed > 0.3
    # Хотя бы одно событие пришло.
    assert any(u.event is not None for u in updates)
    assert any(u.response is not None for u in updates)


async def test_heartbeat_gate_fires_when_events_stop(mock_conn):
    """Гейт 2: после первого события дальше идут пустые ответы;
    через event_timeout_sec — timeout с message 'heartbeat'."""
    svc = AgentBridgeService(mock_conn)

    event = {
        "id": 1, "request_id": "r1", "seq": 1, "event_type": "reasoning",
        "payload": "{}", "created_at": None,
    }
    # Первое событие — есть, дальше — поток пустых ответов.
    mock_conn.fetch.side_effect = [[event]] + [[]] * 100
    mock_conn.fetchrow.return_value = None

    with pytest.raises(AgentBridgeTimeout) as exc_info:
        async for _ in svc.wait_for_completion(
            "r1",
            poll_interval_sec=0.05,
            initial_response_timeout_sec=10,
            event_timeout_sec=0.3,
            max_total_duration_sec=10,
        ):
            pass

    assert "heartbeat" in str(exc_info.value)
    timeout_calls = _timeout_update_calls(mock_conn)
    assert timeout_calls
    assert any("heartbeat" in str(c.args) for c in timeout_calls)


async def test_heartbeat_resets_on_each_event(mock_conn):
    """Гейт 2 сбрасывается на каждом новом событии: события приходят регулярно,
    суммарное время > event_timeout_sec, но timeout не срабатывает."""
    svc = AgentBridgeService(mock_conn)

    def make_event(eid):
        return {
            "id": eid, "request_id": "r1", "seq": eid, "event_type": "reasoning",
            "payload": "{}", "created_at": None,
        }

    # 4 итерации с событием, затем финальный ответ.
    # poll_interval=0.2с; event_timeout=0.5с — событие каждый poll
    # сбрасывает heartbeat, поэтому после 4 итераций (~0.8с) гейт всё ещё живой.
    mock_conn.fetch.side_effect = [
        [make_event(1)],
        [make_event(2)],
        [make_event(3)],
        [make_event(4)],
        [],
    ]
    final = {
        "id": "x", "request_id": "r1", "blocks": "[]",
        "finish_reason": "stop", "token_usage": None,
        "model": None, "created_at": None,
    }
    mock_conn.fetchrow.side_effect = [None, None, None, None, final]

    started = asyncio.get_event_loop().time()
    updates = []
    async for upd in svc.wait_for_completion(
        "r1",
        poll_interval_sec=0.2,
        initial_response_timeout_sec=10,
        event_timeout_sec=0.5,
        max_total_duration_sec=10,
    ):
        updates.append(upd)
    elapsed = asyncio.get_event_loop().time() - started

    # Прошло больше event_timeout_sec — но timeout не сработал, потому что
    # каждое событие сбрасывало heartbeat.
    assert elapsed > 0.5
    assert not _timeout_update_calls(mock_conn)
    # Получили 4 события + 1 ответ.
    assert sum(1 for u in updates if u.event is not None) == 4
    assert sum(1 for u in updates if u.response is not None) == 1


async def test_max_total_duration_fires_even_with_heartbeat(mock_conn):
    """Гейт 3: события приходят регулярно (heartbeat жив), но достигнут абсолютный
    максимум — timeout с message 'максимальная длительность'."""
    svc = AgentBridgeService(mock_conn)

    def make_event(eid):
        return {
            "id": eid, "request_id": "r1", "seq": eid, "event_type": "reasoning",
            "payload": "{}", "created_at": None,
        }

    # Бесконечный поток событий каждый poll. Финального ответа нет.
    mock_conn.fetch.side_effect = [[make_event(i)] for i in range(1, 1000)]
    mock_conn.fetchrow.return_value = None

    with pytest.raises(AgentBridgeTimeout) as exc_info:
        async for _ in svc.wait_for_completion(
            "r1",
            poll_interval_sec=0.1,
            initial_response_timeout_sec=10,
            event_timeout_sec=10,
            max_total_duration_sec=0.5,
        ):
            pass

    assert "max total duration" in str(exc_info.value)
    timeout_calls = _timeout_update_calls(mock_conn)
    assert timeout_calls
    assert any("максимальная длительность" in str(c.args) for c in timeout_calls)
