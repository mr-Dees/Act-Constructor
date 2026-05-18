"""Тесты репозитория chat_tool_metrics (mock_conn)."""

from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.chat_tool_metrics_repository import (
    ChatToolMetricsRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


async def test_record_success_inserts_all_fields(mock_conn):
    """Успешная запись: все поля проброшены в INSERT в правильном порядке."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="chat.list_pages",
        status="success",
        latency_ms=42,
        username="user1",
        conversation_id="conv-1",
        error_message=None,
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "chat_tool_metrics" in sql
    # tool_name, status, latency_ms, username, conversation_id, error_message
    assert len(params) == 6
    assert params[0] == "chat.list_pages"
    assert params[1] == "success"
    assert params[2] == 42
    assert params[3] == "user1"
    assert params[4] == "conv-1"
    assert params[5] is None


async def test_record_error_status_with_message(mock_conn):
    """Статус error пишется вместе с error_message."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="acts.open_act_page",
        status="error",
        latency_ms=150,
        username="user1",
        conversation_id="conv-1",
        error_message="Tool exploded",
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[1] == "error"
    assert params[5] == "Tool exploded"


async def test_record_validation_error_status(mock_conn):
    """Статус validation_error поддерживается."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="acts.open_act_page",
        status="validation_error",
        latency_ms=0,
        username="user1",
        conversation_id="conv-1",
        error_message="отсутствует параметр km_number",
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[1] == "validation_error"
    assert params[2] == 0
    assert "km_number" in params[5]


async def test_record_with_null_username_and_conversation(mock_conn):
    """username и conversation_id опциональны — допустим None."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="chat.notify",
        status="success",
        latency_ms=5,
        username=None,
        conversation_id=None,
        error_message=None,
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[3] is None
    assert params[4] is None


async def test_record_latency_boundary_zero(mock_conn):
    """latency_ms=0 — граничное значение (валидация падений до handler)."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="t",
        status="validation_error",
        latency_ms=0,
    )
    _, *params = mock_conn.execute.call_args.args
    assert params[2] == 0


async def test_record_latency_large_value_preserved(mock_conn):
    """Большое значение latency_ms (близкое к таймауту) не теряется."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="t",
        status="error",
        latency_ms=30_000,
    )
    _, *params = mock_conn.execute.call_args.args
    assert params[2] == 30_000


async def test_record_latency_float_coerced_to_int(mock_conn):
    """Float latency_ms приводится к int — int(...) защищает от float-ошибки."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record(
        tool_name="t",
        status="success",
        latency_ms=12.7,  # type: ignore[arg-type]
    )
    _, *params = mock_conn.execute.call_args.args
    assert isinstance(params[2], int)
    assert params[2] == 12


async def test_record_many_executes_executemany(mock_conn):
    """Bulk-INSERT: один executemany с правильным списком кортежей."""
    from app.domains.chat.repositories.chat_tool_metrics_repository import (
        ChatToolMetricRecord,
    )

    repo = ChatToolMetricsRepository(mock_conn)
    records = [
        ChatToolMetricRecord(
            tool_name="chat.list_pages",
            status="success",
            latency_ms=10,
            username="u1",
            conversation_id="c1",
            error_message=None,
        ),
        ChatToolMetricRecord(
            tool_name="acts.open_act_page",
            status="error",
            latency_ms=20,
            username=None,
            conversation_id=None,
            error_message="boom",
        ),
    ]
    await repo.record_many(records)
    mock_conn.executemany.assert_awaited_once()
    sql, params = mock_conn.executemany.call_args.args
    assert "INSERT INTO" in sql
    assert "chat_tool_metrics" in sql
    assert params == [
        ("chat.list_pages", "success", 10, "u1", "c1", None),
        ("acts.open_act_page", "error", 20, None, None, "boom"),
    ]


async def test_record_many_empty_is_noop(mock_conn):
    """Пустой список — не вызывается executemany, не открывается транзакция."""
    repo = ChatToolMetricsRepository(mock_conn)
    await repo.record_many([])
    mock_conn.executemany.assert_not_called()
    mock_conn.transaction.assert_not_called()
