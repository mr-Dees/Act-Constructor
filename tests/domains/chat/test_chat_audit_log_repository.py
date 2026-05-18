"""Тесты репозитория chat_audit_log (mock_conn)."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.chat_audit_log_repository import (
    ChatAuditLogRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


async def test_log_basic_insert(mock_conn):
    """log() пишет INSERT с username/action/conversation_id/details_json."""
    repo = ChatAuditLogRepository(mock_conn)
    await repo.log(
        username="user1",
        action="conversation_created",
        conversation_id="conv-1",
        details={"title": "Привет"},
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "chat_audit_log" in sql
    # username, action, conversation_id, details_json (jsonb)
    assert len(params) == 4
    assert params[0] == "user1"
    assert params[1] == "conversation_created"
    assert params[2] == "conv-1"
    assert json.loads(params[3]) == {"title": "Привет"}


async def test_log_without_details_passes_null(mock_conn):
    """Без details передаётся NULL в details_json — не пустой JSON-объект."""
    repo = ChatAuditLogRepository(mock_conn)
    await repo.log(
        username="user1",
        action="conversation_deleted",
        conversation_id="conv-1",
    )
    _, *params = mock_conn.execute.call_args.args
    assert params[3] is None


async def test_log_without_conversation_id(mock_conn):
    """conversation_id опционален — допустим None."""
    repo = ChatAuditLogRepository(mock_conn)
    await repo.log(
        username="user1",
        action="file_deleted",
        details={"file_id": "f-1"},
    )
    _, *params = mock_conn.execute.call_args.args
    assert params[2] is None
    assert json.loads(params[3]) == {"file_id": "f-1"}


async def test_log_details_serialized_as_json_with_unicode(mock_conn):
    """Кириллица в details сохраняется в utf-8, без \\u-эскейпа."""
    repo = ChatAuditLogRepository(mock_conn)
    await repo.log(
        username="user1",
        action="message_sent",
        conversation_id="conv-1",
        details={"text": "Привет, мир"},
    )
    _, *params = mock_conn.execute.call_args.args
    # ensure_ascii=False — кириллица в плейн-формате
    assert "Привет" in params[3]
    assert json.loads(params[3]) == {"text": "Привет, мир"}
