"""Тесты репозитория chat_agent_messages_bus (bus-таблица канала к внешнему агенту).

Покрывают: insert_question, get_by_uid, get_questions (пустой и непустой
списки), set_status. Стратегия: mock_conn + autouse-патч get_adapter —
идентична test_message_repository.py.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.agent_message_repository import (
    AgentMessageRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name, schema='': name
    adapter.qualify_table_name = lambda name, schema='': (
        f"{schema}.{name}" if schema else name
    )
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


def test_bus_table_name_is_not_prefixed():
    """Имя bus-таблицы НЕ префиксуется DATABASE__TABLE_PREFIX.

    Шина — интеграционный «провод» к внешнему агенту: репозиторий квалифицирует
    имя только схемой (qualify_table_name), без префикса приложения. Имя задаётся
    настройкой CHAT__AGENT_CHANNEL__TABLE_NAME целиком.
    """
    adapter = MagicMock()
    # get_table_name приклеил бы префикс — если бы его позвали, тест бы упал.
    adapter.get_table_name = lambda name, schema='': f"t_db_oarb_audit_act_{name}"
    adapter.qualify_table_name = lambda name, schema='': (
        f"{schema}.{name}" if schema else name
    )
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        repo = AgentMessageRepository(
            MagicMock(), "chat_agent_messages_bus", schema="",
        )
    assert repo.table == "chat_agent_messages_bus"


# ── insert_question ──────────────────────────────────────────────────────


async def test_insert_question_returns_parsed_row(mock_conn):
    """insert_question делает INSERT с role='user', status='pending' и возвращает запись."""
    mock_conn.fetchrow.return_value = {
        "id": "msg-1",
        "chat_id": "chat-1",
        "user_id": "user1",
        "conversation_id": "conv-1",
        "role": "user",
        "content": "Привет",
        "media": None,
        "metadata": '{"source": "aw"}',
        "buttons": None,
        "status": "pending",
    }
    repo = AgentMessageRepository(mock_conn)
    result = await repo.insert_question(
        id="msg-1",
        chat_id="chat-1",
        user_id="user1",
        conversation_id="conv-1",
        content="Привет",
        metadata={"source": "aw"},
    )

    # Проверяем SQL-запрос
    sql, *params = mock_conn.fetchrow.call_args.args
    assert "INSERT INTO" in sql
    assert "chat_agent_messages_bus" in sql
    assert "'user'" in sql
    assert "'pending'" in sql
    assert "RETURNING *" in sql

    # Позиционные параметры
    assert params[0] == "msg-1"       # id
    assert params[1] == "chat-1"      # chat_id
    assert params[2] == "user1"       # user_id
    assert params[3] == "conv-1"      # conversation_id
    assert params[4] == "Привет"      # content

    # metadata сериализована в JSON-строку
    assert json.loads(params[6]) == {"source": "aw"}

    # JSONB-поля раскодированы в _parse_row
    assert result["metadata"] == {"source": "aw"}
    assert result["status"] == "pending"
    assert result["role"] == "user"


async def test_insert_question_media_serialized(mock_conn):
    """media передаётся как JSON-строка в параметре $6."""
    mock_conn.fetchrow.return_value = {
        "id": "msg-2",
        "chat_id": "chat-1",
        "user_id": "user1",
        "conversation_id": "conv-2",
        "role": "user",
        "content": "файл",
        "media": '[{"type": "file", "url": "x"}]',
        "metadata": "{}",
        "buttons": None,
        "status": "pending",
    }
    repo = AgentMessageRepository(mock_conn)
    media = [{"type": "file", "url": "x"}]
    await repo.insert_question(
        id="msg-2",
        chat_id="chat-1",
        user_id="user1",
        conversation_id="conv-2",
        content="файл",
        media=media,
    )
    _, *params = mock_conn.fetchrow.call_args.args
    # media — пятый параметр (0-based: 5)
    assert json.loads(params[5]) == media


async def test_insert_question_no_media_passes_none(mock_conn):
    """Если media не передан, в параметр идёт None."""
    mock_conn.fetchrow.return_value = {
        "id": "m", "chat_id": "c", "user_id": "u",
        "conversation_id": "cv", "role": "user", "content": "x",
        "media": None, "metadata": "{}", "buttons": None, "status": "pending",
    }
    repo = AgentMessageRepository(mock_conn)
    await repo.insert_question(
        id="m", chat_id="c", user_id="u", conversation_id="cv", content="x",
    )
    _, *params = mock_conn.fetchrow.call_args.args
    assert params[5] is None  # media


# ── get_by_uid ───────────────────────────────────────────────────────────


async def test_get_by_uid_found(mock_conn):
    """get_by_uid возвращает запись по conversation_id."""
    mock_conn.fetchrow.return_value = {
        "id": "msg-1",
        "chat_id": "chat-1",
        "user_id": "user1",
        "conversation_id": "conv-1",
        "role": "user",
        "content": "hi",
        "media": None,
        "metadata": '{"k": "v"}',
        "buttons": None,
        "status": "pending",
    }
    repo = AgentMessageRepository(mock_conn)
    result = await repo.get_by_uid("conv-1")

    sql, conv_id = mock_conn.fetchrow.call_args.args
    assert "SELECT" in sql
    assert "WHERE conversation_id = $1" in sql
    assert conv_id == "conv-1"

    assert result["id"] == "msg-1"
    assert result["metadata"] == {"k": "v"}  # JSONB раскодирован


async def test_get_by_uid_not_found(mock_conn):
    """get_by_uid возвращает None если строка не найдена."""
    mock_conn.fetchrow.return_value = None
    repo = AgentMessageRepository(mock_conn)
    result = await repo.get_by_uid("no-such-conv")
    assert result is None


# ── get_questions ────────────────────────────────────────────────────────


async def test_get_questions_empty_list_no_db_call(mock_conn):
    """Пустой uids → [] без обращения к БД."""
    repo = AgentMessageRepository(mock_conn)
    result = await repo.get_questions([])
    assert result == []
    mock_conn.fetch.assert_not_called()


async def test_get_questions_returns_parsed_rows(mock_conn):
    """Непустой uids → SELECT ANY($1::varchar[]), результат раскодирован."""
    rows = [
        {
            "id": "msg-1", "chat_id": "c1", "user_id": "u1",
            "conversation_id": "cv1", "role": "user", "content": "a",
            "media": None, "metadata": '{"x": 1}', "buttons": None,
            "status": "pending",
        },
        {
            "id": "msg-2", "chat_id": "c1", "user_id": "u1",
            "conversation_id": "cv2", "role": "user", "content": "b",
            "media": '[1, 2]', "metadata": "{}", "buttons": None,
            "status": "in_progress",
        },
    ]
    mock_conn.fetch.return_value = rows
    repo = AgentMessageRepository(mock_conn)
    result = await repo.get_questions(["cv1", "cv2"])

    sql, uids = mock_conn.fetch.call_args.args
    assert "ANY($1::varchar[])" in sql
    assert uids == ["cv1", "cv2"]

    assert len(result) == 2
    assert result[0]["metadata"] == {"x": 1}  # JSONB раскодирован
    assert result[1]["media"] == [1, 2]        # JSONB раскодирован


# ── set_status ───────────────────────────────────────────────────────────


async def test_set_status_executes_update(mock_conn):
    """set_status делает UPDATE status + updated_at по conversation_id."""
    repo = AgentMessageRepository(mock_conn)
    await repo.set_status(conversation_id="conv-1", status="in_progress")

    sql, status, conv_id = mock_conn.execute.call_args.args
    assert "UPDATE" in sql
    assert "chat_agent_messages_bus" in sql
    assert "status = $1" in sql
    assert "updated_at = CURRENT_TIMESTAMP" in sql
    assert "WHERE conversation_id = $2" in sql
    assert status == "in_progress"
    assert conv_id == "conv-1"


# ── count_active_for_user ────────────────────────────────────────────────


async def test_count_active_for_user_returns_count(mock_conn):
    """count_active_for_user делает SELECT COUNT по user_id, role='user' и статусам pending/in_progress."""
    mock_conn.fetchval.return_value = 2
    repo = AgentMessageRepository(mock_conn)
    result = await repo.count_active_for_user("user1")

    sql, user_id = mock_conn.fetchval.call_args.args
    assert "SELECT COUNT(*)" in sql
    assert "chat_agent_messages_bus" in sql
    assert "user_id = $1" in sql
    assert "role = 'user'" in sql
    assert "'pending'" in sql
    assert "'in_progress'" in sql
    assert user_id == "user1"
    assert result == 2


async def test_count_active_for_user_returns_zero_on_none(mock_conn):
    """count_active_for_user возвращает 0 если fetchval вернул None."""
    mock_conn.fetchval.return_value = None
    repo = AgentMessageRepository(mock_conn)
    result = await repo.count_active_for_user("user-empty")
    assert result == 0
