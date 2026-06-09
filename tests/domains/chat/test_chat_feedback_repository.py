"""Тесты репозитория chat_message_feedback (mock_conn)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.chat_message_feedback_repository import (
    ChatMessageFeedbackRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name, schema="": name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


async def test_upsert_inserts_when_absent(mock_conn):
    """Записи нет → ветка INSERT, транзакция открыта."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    inserted = {
        "conversation_id": "c1", "message_id": "m1", "user_id": "u1",
        "rating": "down", "reasons": ["inaccurate"], "comment": "плохо",
        "source": "user", "route_type": "kb_agent", "agent_mode": "always",
        "model": None, "created_at": None, "updated_at": None,
    }
    mock_conn.fetchrow.side_effect = [None, inserted]  # SELECT→None, INSERT RETURNING→row

    result = await repo.upsert(
        conversation_id="c1", message_id="m1", user_id="u1",
        rating="down", reasons=["inaccurate"], comment="плохо",
        route_type="kb_agent", agent_mode="always",
    )

    assert result["rating"] == "down"
    assert result["reasons"] == ["inaccurate"]
    assert mock_conn.fetchrow.await_count == 2
    insert_sql = mock_conn.fetchrow.await_args_list[1].args[0]
    assert "INSERT INTO" in insert_sql
    assert "chat_message_feedback" in insert_sql
    mock_conn.transaction.assert_called_once()


async def test_upsert_updates_when_present(mock_conn):
    """Запись есть → ветка UPDATE с явным updated_at."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    updated = {
        "conversation_id": "c1", "message_id": "m1", "user_id": "u1",
        "rating": "up", "reasons": None, "comment": None, "source": "user",
        "route_type": "smalltalk", "agent_mode": "off", "model": None,
        "created_at": None, "updated_at": None,
    }
    mock_conn.fetchrow.side_effect = [{"?column?": 1}, updated]  # SELECT→truthy, UPDATE→row

    result = await repo.upsert(
        conversation_id="c1", message_id="m1", user_id="u1", rating="up",
    )

    update_sql = mock_conn.fetchrow.await_args_list[1].args[0]
    assert "UPDATE" in update_sql
    assert "updated_at = CURRENT_TIMESTAMP" in update_sql
    assert result["rating"] == "up"


async def test_upsert_serializes_reasons_to_json(mock_conn):
    """reasons сериализуется в JSON-строку для ::jsonb-параметра."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetchrow.side_effect = [None, {"rating": "down", "reasons": ["a", "b"]}]

    await repo.upsert(
        conversation_id="c1", message_id="m1", user_id="u1",
        rating="down", reasons=["a", "b"],
    )

    insert_args = mock_conn.fetchrow.await_args_list[1].args
    # sql, conversation_id, message_id, user_id, rating, reasons_json, comment, ...
    assert json.loads(insert_args[5]) == ["a", "b"]


async def test_upsert_reasons_none_passes_null(mock_conn):
    """Пустые reasons → NULL (None) в параметрах."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetchrow.side_effect = [None, {"rating": "up", "reasons": None}]

    await repo.upsert(
        conversation_id="c1", message_id="m1", user_id="u1", rating="up",
    )

    insert_args = mock_conn.fetchrow.await_args_list[1].args
    assert insert_args[5] is None


async def test_clear_returns_true_when_deleted(mock_conn):
    """DELETE 1 → True, фильтр по (message_id, user_id)."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.execute.return_value = "DELETE 1"

    assert await repo.clear(message_id="m1", user_id="u1") is True
    sql, *params = mock_conn.execute.call_args.args
    assert "DELETE FROM" in sql
    assert params == ["m1", "u1"]


async def test_clear_returns_false_when_absent(mock_conn):
    """DELETE 0 → False (идемпотентно)."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.execute.return_value = "DELETE 0"
    assert await repo.clear(message_id="m1", user_id="u1") is False


async def test_clear_handles_unexpected_status_format(mock_conn):
    """Неожиданный формат статуса (без числа) → False, без исключения."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.execute.return_value = "DELETE"
    assert await repo.clear(message_id="m1", user_id="u1") is False


async def test_get_for_message_parses_reasons(mock_conn):
    """reasons из JSON-строки парсится в список."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetchrow.return_value = {
        "message_id": "m1", "user_id": "u1", "rating": "down",
        "reasons": json.dumps(["inaccurate"]),
    }
    res = await repo.get_for_message(message_id="m1", user_id="u1")
    assert res["reasons"] == ["inaccurate"]


async def test_get_for_message_none(mock_conn):
    """Нет оценки → None."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await repo.get_for_message(message_id="m1", user_id="u1") is None


async def test_get_map_for_conversation(mock_conn):
    """Карта message_id → оценка по беседе и пользователю."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {"message_id": "m1", "user_id": "u1", "rating": "up", "reasons": None},
        {"message_id": "m2", "user_id": "u1", "rating": "down",
         "reasons": json.dumps(["other"])},
    ]
    m = await repo.get_map_for_conversation(conversation_id="c1", user_id="u1")
    assert set(m.keys()) == {"m1", "m2"}
    assert m["m1"]["rating"] == "up"
    assert m["m2"]["reasons"] == ["other"]
    # фильтр по conversation_id и user_id
    sql, *params = mock_conn.fetch.call_args.args
    assert params == ["c1", "u1"]


# ── Аналитика ────────────────────────────────────────────────────────────


async def test_get_stats_aggregates_counts_routes_models_reasons(mock_conn):
    """get_stats считает total/up/down/like_rate и срезы по route/model/reason."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetch.side_effect = [
        # rating
        [{"rating": "up", "cnt": 7}, {"rating": "down", "cnt": 3}],
        # route_type x rating
        [
            {"route_type": "kb_agent", "rating": "up", "cnt": 4},
            {"route_type": "kb_agent", "rating": "down", "cnt": 2},
            {"route_type": "smalltalk", "rating": "up", "cnt": 3},
            {"route_type": "smalltalk", "rating": "down", "cnt": 1},
        ],
        # model x rating
        [{"model": "gpt-4o", "rating": "up", "cnt": 7},
         {"model": "gpt-4o", "rating": "down", "cnt": 3}],
        # reasons sample (down)
        [{"reasons": json.dumps(["inaccurate", "other"])},
         {"reasons": json.dumps(["inaccurate"])}],
    ]

    stats = await repo.get_stats()

    assert stats["total"] == 10
    assert stats["up"] == 7
    assert stats["down"] == 3
    assert stats["like_rate"] == 0.7
    assert stats["by_route"]["kb_agent"] == {"up": 4, "down": 2}
    assert stats["by_model"]["gpt-4o"] == {"up": 7, "down": 3}
    assert stats["by_reason"] == {"inaccurate": 2, "other": 1}


async def test_get_stats_empty_like_rate_none(mock_conn):
    """Нет оценок → like_rate=None, без деления на ноль."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetch.side_effect = [[], [], [], []]
    stats = await repo.get_stats()
    assert stats["total"] == 0
    assert stats["like_rate"] is None


async def test_list_feedback_returns_items_and_total(mock_conn):
    """list_feedback: COUNT + выборка с join'ом контента ответа."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetchval.return_value = 2
    mock_conn.fetch.return_value = [
        {
            "message_id": "m1", "conversation_id": "c1", "user_id": "u1",
            "rating": "down", "reasons": json.dumps(["inaccurate"]),
            "comment": "плохо", "route_type": "kb_agent", "agent_mode": "always",
            "model": "gpt-4o", "created_at": None, "updated_at": None,
            "message_content": json.dumps([{"type": "text", "content": "Ответ"}]),
            "message_status": "complete",
        },
    ]
    items, total = await repo.list_feedback(rating="down", limit=10, offset=0)
    assert total == 2
    assert len(items) == 1
    assert items[0]["reasons"] == ["inaccurate"]
    # message_content десериализован в список блоков
    assert items[0]["message_content"] == [{"type": "text", "content": "Ответ"}]


async def test_get_all_for_conversation_groups_by_message(mock_conn):
    """get_all_for_conversation группирует оценки всех пользователей по message_id."""
    repo = ChatMessageFeedbackRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {"message_id": "a1", "user_id": "u1", "rating": "up", "reasons": None},
        {"message_id": "a1", "user_id": "u2", "rating": "down",
         "reasons": json.dumps(["other"])},
        {"message_id": "a2", "user_id": "u1", "rating": "up", "reasons": None},
    ]
    grouped = await repo.get_all_for_conversation("c1")
    assert set(grouped.keys()) == {"a1", "a2"}
    assert len(grouped["a1"]) == 2
    assert grouped["a1"][1]["reasons"] == ["other"]
