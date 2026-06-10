"""Тесты репозитория chat_messages (mock_conn).

Покрывают streaming-методы Phase 0 «D»: create_streaming, append_block,
finalize, mark_failed. RMW-стратегия (read-modify-write под FOR UPDATE)
проверяется через ассерты на SELECT … FOR UPDATE и последующий UPDATE.
"""

import json
from unittest.mock import MagicMock, patch

import asyncpg
import pytest

from app.domains.chat.repositories.message_repository import MessageRepository


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name, schema='': name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


# ── create_streaming ─────────────────────────────────────────────────────


async def test_create_streaming_happy_path(mock_conn):
    """create_streaming делает INSERT с content='[]'::jsonb и status='streaming'."""
    mock_conn.fetchrow.return_value = {
        "id": "msg-1",
        "conversation_id": "conv-1",
        "role": "assistant",
        "content": "[]",
        "model": "gpt-4",
        "token_usage": None,
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    result = await repo.create_streaming(
        message_id="msg-1",
        conversation_id="conv-1",
        model="gpt-4",
    )
    sql, *params = mock_conn.fetchrow.call_args.args
    assert "INSERT INTO" in sql
    assert "chat_messages" in sql
    assert "'streaming'" in sql
    assert "'[]'::jsonb" in sql
    assert params[0] == "msg-1"
    assert params[1] == "conv-1"
    assert params[2] == "assistant"
    assert params[3] == "gpt-4"
    # content декодирован в []
    assert result["content"] == []
    assert result["status"] == "streaming"


async def test_create_streaming_recovery_on_unique_violation(mock_conn):
    """При UniqueViolation на id возвращает существующую запись (crash-recovery)."""
    existing_row = {
        "id": "msg-1",
        "conversation_id": "conv-1",
        "role": "assistant",
        "content": '[{"type":"reasoning","content":"prev"}]',
        "model": "gpt-4",
        "token_usage": None,
        "status": "streaming",
    }
    mock_conn.fetchrow.side_effect = [
        asyncpg.UniqueViolationError("dup"),
        existing_row,
    ]
    repo = MessageRepository(mock_conn)
    result = await repo.create_streaming(
        message_id="msg-1",
        conversation_id="conv-1",
    )
    # Был fallback SELECT
    assert mock_conn.fetchrow.call_count == 2
    second_call_sql = mock_conn.fetchrow.call_args_list[1].args[0]
    assert "SELECT" in second_call_sql
    assert "WHERE id = $1" in second_call_sql
    # content вернулся раскодированным
    assert result["content"] == [{"type": "reasoning", "content": "prev"}]


# ── append_block ─────────────────────────────────────────────────────────


async def test_append_block_happy_path(mock_conn):
    """append_block читает существующий content под FOR UPDATE и пишет UPDATE."""
    mock_conn.fetchrow.return_value = {
        "content": '[{"type":"reasoning","block_id":"b1","content":"hi"}]',
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    new_block = {"type": "text", "block_id": "b2", "content": "next"}
    ok = await repo.append_block(message_id="msg-1", block=new_block)
    assert ok is True
    # SELECT … FOR UPDATE был вызван
    select_sql = mock_conn.fetchrow.call_args.args[0]
    assert "FOR UPDATE" in select_sql
    # UPDATE прошёл и в payload оба блока (старый + новый)
    update_sql, payload, msg_id = mock_conn.execute.call_args.args
    assert "UPDATE" in update_sql
    content = json.loads(payload)
    assert len(content) == 2
    assert content[1] == new_block
    assert msg_id == "msg-1"


async def test_append_block_idempotent_by_block_id(mock_conn):
    """Повторный append того же block_id — no-op, UPDATE не вызывается."""
    mock_conn.fetchrow.return_value = {
        "content": [{"type": "reasoning", "block_id": "b1", "content": "hi"}],
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.append_block(
        message_id="msg-1",
        block={"type": "reasoning", "block_id": "b1", "content": "hi"},
    )
    assert ok is True
    mock_conn.execute.assert_not_called()


async def test_append_block_returns_false_when_not_streaming(mock_conn):
    """Если status != 'streaming' (race с finalize) — возвращает False, UPDATE нет."""
    mock_conn.fetchrow.return_value = {
        "content": [],
        "status": "complete",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.append_block(
        message_id="msg-1",
        block={"type": "text", "block_id": "b1", "content": "x"},
    )
    assert ok is False
    mock_conn.execute.assert_not_called()


async def test_append_block_missing_row_returns_false(mock_conn):
    """Если строки нет — False, никаких UPDATE."""
    mock_conn.fetchrow.return_value = None
    repo = MessageRepository(mock_conn)
    ok = await repo.append_block(
        message_id="missing",
        block={"type": "text", "block_id": "b1"},
    )
    assert ok is False
    mock_conn.execute.assert_not_called()


# ── finalize ─────────────────────────────────────────────────────────────


async def test_finalize_happy_path_with_merge(mock_conn):
    """finalize мержит final_blocks к накопленным existing и ставит status='complete'."""
    mock_conn.fetchrow.return_value = {
        "content": '[{"type":"reasoning","block_id":"r1","content":"thinking"}]',
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    final_blocks = [
        {"type": "text", "block_id": "t1", "content": "Ответ"},
    ]
    ok = await repo.finalize(
        message_id="msg-1",
        final_blocks=final_blocks,
        model="gpt-4",
        token_usage={"input_tokens": 100, "output_tokens": 50},
    )
    assert ok is True
    update_sql, content_json, model, tok_json, msg_id = mock_conn.execute.call_args.args
    assert "status = 'complete'" in update_sql
    assert "COALESCE($2, model)" in update_sql
    merged = json.loads(content_json)
    assert len(merged) == 2
    # reasoning сохранён, поверх дописан text
    assert merged[0]["block_id"] == "r1"
    assert merged[1]["block_id"] == "t1"
    assert model == "gpt-4"
    assert json.loads(tok_json) == {"input_tokens": 100, "output_tokens": 50}
    assert msg_id == "msg-1"


async def test_finalize_does_not_duplicate_block_with_same_block_id(mock_conn):
    """Повторно присланный финальный блок с тем же block_id не дублируется — замещает накопленный на его месте."""
    mock_conn.fetchrow.return_value = {
        "content": [
            {"type": "reasoning", "block_id": "r1", "content": "th"},
            {"type": "text", "block_id": "t1", "content": "partial"},
        ],
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    # Final присылает t1 заново — блок замещается на месте, дубля нет.
    final_blocks = [
        {"type": "text", "block_id": "t1", "content": "partial"},
        {"type": "buttons", "block_id": "b1", "items": []},
    ]
    ok = await repo.finalize(
        message_id="msg-1",
        final_blocks=final_blocks,
    )
    assert ok is True
    _, content_json, *_ = mock_conn.execute.call_args.args
    merged = json.loads(content_json)
    # r1, t1 (один раз), b1
    ids = [b["block_id"] for b in merged]
    assert ids == ["r1", "t1", "b1"]


async def test_finalize_returns_false_when_not_streaming(mock_conn):
    """Повторный finalize / гонка — False, UPDATE не вызывается."""
    mock_conn.fetchrow.return_value = {
        "content": [],
        "status": "complete",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.finalize(message_id="msg-1", final_blocks=[])
    assert ok is False
    mock_conn.execute.assert_not_called()


# ── upsert_block ─────────────────────────────────────────────────────────


async def test_upsert_block_updates_existing_by_block_id(mock_conn):
    """upsert_block заменяет блок с тем же block_id на его позиции, не плодит дубли."""
    existing = [{"type": "reasoning", "content": "стар", "block_id": "a:reasoning:0"}]
    mock_conn.fetchrow.return_value = {
        "content": json.dumps(existing),
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.upsert_block(
        message_id="m1",
        block={"type": "reasoning", "content": "стар и новый", "block_id": "a:reasoning:0"},
    )
    assert ok is True
    # SELECT … FOR UPDATE должен быть вызван
    select_sql = mock_conn.fetchrow.call_args.args[0]
    assert "FOR UPDATE" in select_sql
    # UPDATE выполнен, payload содержит ровно один блок с обновлённым content
    update_sql, payload, msg_id = mock_conn.execute.call_args.args
    assert "UPDATE" in update_sql
    content = json.loads(payload)
    assert len(content) == 1
    assert content[0]["content"] == "стар и новый"
    assert msg_id == "m1"


async def test_upsert_block_appends_when_absent(mock_conn):
    """upsert_block дописывает блок, если block_id ещё не встречался."""
    mock_conn.fetchrow.return_value = {
        "content": json.dumps([]),
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    new_block = {"type": "reasoning", "content": "первый", "block_id": "a:reasoning:0"}
    ok = await repo.upsert_block(message_id="m1", block=new_block)
    assert ok is True
    _, payload, _ = mock_conn.execute.call_args.args
    content = json.loads(payload)
    assert len(content) == 1
    assert content[0] == new_block


async def test_upsert_block_false_when_not_streaming(mock_conn):
    """upsert_block возвращает False и не делает UPDATE, если status != 'streaming'."""
    mock_conn.fetchrow.return_value = {
        "content": json.dumps([]),
        "status": "complete",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.upsert_block(
        message_id="m1",
        block={"type": "reasoning", "content": "x", "block_id": "a:reasoning:0"},
    )
    assert ok is False
    mock_conn.execute.assert_not_called()


async def test_upsert_block_false_without_block_id(mock_conn):
    """upsert_block возвращает False без обращения к БД, если блок не имеет block_id."""
    repo = MessageRepository(mock_conn)
    ok = await repo.upsert_block(
        message_id="m1",
        block={"type": "text", "content": "нет id"},
    )
    assert ok is False
    mock_conn.fetchrow.assert_not_called()
    mock_conn.execute.assert_not_called()


# ── finalize — replace-мерж ───────────────────────────────────────────────


async def test_finalize_replaces_existing_block_with_same_block_id(mock_conn):
    """finalize ЗАМЕЩАЕТ накопленный блок финальным на той же позиции.

    Если поллер накопил частичный reasoning (block_id="X"), а финальный блок
    агента содержит полный текст с тем же block_id="X", финальная версия
    должна встать на место частичной (не дублироваться), а новые блоки без
    совпадения по id дописываются в конец.
    """
    mock_conn.fetchrow.return_value = {
        "content": json.dumps([
            {"type": "reasoning", "block_id": "X", "content": "частичный"},
        ]),
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    final_blocks = [
        {"type": "reasoning", "block_id": "X", "content": "полный"},
        {"type": "text", "content": "Ответ"},  # без block_id — дописывается в конец
    ]
    ok = await repo.finalize(message_id="msg-1", final_blocks=final_blocks)
    assert ok is True
    _, content_json, *_ = mock_conn.execute.call_args.args
    merged = json.loads(content_json)
    # Итого 2 блока: reasoning на месте (индекс 0) + text в конце
    assert len(merged) == 2
    assert merged[0]["block_id"] == "X"
    assert merged[0]["content"] == "полный"
    assert merged[1]["type"] == "text"
    assert merged[1]["content"] == "Ответ"


# ── mark_failed ──────────────────────────────────────────────────────────


async def test_mark_failed_happy_path(mock_conn):
    """mark_failed дописывает error-блок и ставит status='failed' в одной транзакции."""
    mock_conn.fetchrow.return_value = {
        "content": [{"type": "reasoning", "block_id": "r1", "content": "x"}],
        "status": "streaming",
    }
    repo = MessageRepository(mock_conn)
    error_block = {"type": "error", "block_id": "e1", "message": "boom"}
    ok = await repo.mark_failed(message_id="msg-1", error_block=error_block)
    assert ok is True
    update_sql, payload, msg_id = mock_conn.execute.call_args.args
    assert "status = 'failed'" in update_sql
    content = json.loads(payload)
    assert content[-1] == error_block
    assert msg_id == "msg-1"


async def test_mark_failed_returns_false_when_not_streaming(mock_conn):
    """Повторный mark_failed / гонка — False."""
    mock_conn.fetchrow.return_value = {
        "content": [],
        "status": "failed",
    }
    repo = MessageRepository(mock_conn)
    ok = await repo.mark_failed(
        message_id="msg-1",
        error_block={"type": "error", "block_id": "e1", "message": "x"},
    )
    assert ok is False
    mock_conn.execute.assert_not_called()
