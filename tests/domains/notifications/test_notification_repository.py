"""Тесты репозитория центра уведомлений.

Покрывают: list_for_user (LEFT JOIN state, broadcast-видимость, скрытие
dismissed, COALESCE is_read), unread_count, mark_read/dismiss (lazy upsert:
UPDATE; если 0 строк — INSERT), mark_all_read, create. Стратегия: mock_conn
+ autouse-патч get_adapter — как в tests/domains/chat/test_message_repository.py.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.domains.notifications.repositories.notification_repository import (
    NotificationRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


# ── list_for_user ──────────────────────────────────────────────────────────


async def test_list_for_user_query_shape(mock_conn):
    """list_for_user строит SELECT с LEFT JOIN state и фильтром broadcast."""
    mock_conn.fetch.return_value = []
    repo = NotificationRepository(mock_conn)
    await repo.list_for_user("user1", limit=10)

    sql, *params = mock_conn.fetch.call_args.args
    assert "FROM notifications n" in sql
    assert "LEFT JOIN notification_state s" in sql
    # broadcast (recipient IS NULL) виден наряду с адресными
    assert "n.recipient_user_id = $1 OR n.recipient_user_id IS NULL" in sql
    # dismissed скрыт
    assert "COALESCE(s.is_dismissed, FALSE) = FALSE" in sql
    # ленивый state: is_read через COALESCE
    assert "COALESCE(s.is_read, FALSE) AS is_read" in sql
    assert "ORDER BY n.created_at DESC" in sql
    assert params[0] == "user1"
    assert params[1] == 10


async def test_list_for_user_returns_dicts(mock_conn):
    """list_for_user возвращает строки как dict."""
    mock_conn.fetch.return_value = [
        {"id": "n1", "source": "acts", "severity": "info", "title": "T",
         "body": None, "link": None, "element_ref": None,
         "created_at": "2026-06-07", "is_read": False},
    ]
    repo = NotificationRepository(mock_conn)
    result = await repo.list_for_user("user1")
    assert result == [
        {"id": "n1", "source": "acts", "severity": "info", "title": "T",
         "body": None, "link": None, "element_ref": None,
         "created_at": "2026-06-07", "is_read": False},
    ]


# ── unread_count ────────────────────────────────────────────────────────────


async def test_unread_count_query_and_value(mock_conn):
    """unread_count считает непрочитанные видимые (нет state ИЛИ is_read=FALSE)."""
    mock_conn.fetchval.return_value = 3
    repo = NotificationRepository(mock_conn)
    result = await repo.unread_count("user1")

    sql, user_id = mock_conn.fetchval.call_args.args
    assert "SELECT COUNT(*)" in sql
    assert "COALESCE(s.is_read, FALSE) = FALSE" in sql
    assert "COALESCE(s.is_dismissed, FALSE) = FALSE" in sql
    assert user_id == "user1"
    assert result == 3


async def test_unread_count_none_returns_zero(mock_conn):
    """unread_count возвращает 0, если fetchval вернул None."""
    mock_conn.fetchval.return_value = None
    repo = NotificationRepository(mock_conn)
    assert await repo.unread_count("user1") == 0


# ── mark_read (lazy upsert) ─────────────────────────────────────────────────


async def test_mark_read_updates_existing_state(mock_conn):
    """mark_read: если UPDATE затронул строку — INSERT не делается."""
    mock_conn.execute.return_value = "UPDATE 1"
    repo = NotificationRepository(mock_conn)
    await repo.mark_read("n1", "user1")

    assert mock_conn.execute.call_count == 1
    sql, nid, uid = mock_conn.execute.call_args.args
    assert "UPDATE notification_state" in sql
    assert "is_read = TRUE" in sql
    assert "updated_at = CURRENT_TIMESTAMP" in sql
    assert nid == "n1"
    assert uid == "user1"


async def test_mark_read_inserts_when_no_state(mock_conn):
    """mark_read: если UPDATE затронул 0 строк — лениво создаётся state INSERT'ом."""
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    repo = NotificationRepository(mock_conn)
    await repo.mark_read("n1", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *insert_params = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "TRUE, FALSE" in insert_sql  # is_read=TRUE, is_dismissed=FALSE
    assert insert_params == ["n1", "user1"]


# ── dismiss (lazy upsert) ───────────────────────────────────────────────────


async def test_dismiss_updates_existing_state(mock_conn):
    """dismiss: UPDATE затронул строку — без INSERT."""
    mock_conn.execute.return_value = "UPDATE 1"
    repo = NotificationRepository(mock_conn)
    await repo.dismiss("n1", "user1")

    assert mock_conn.execute.call_count == 1
    sql, *_ = mock_conn.execute.call_args.args
    assert "UPDATE notification_state" in sql
    assert "is_dismissed = TRUE" in sql
    assert "updated_at = CURRENT_TIMESTAMP" in sql


async def test_dismiss_inserts_when_no_state(mock_conn):
    """dismiss: UPDATE 0 → INSERT с is_dismissed=TRUE."""
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    repo = NotificationRepository(mock_conn)
    await repo.dismiss("n1", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *insert_params = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "FALSE, TRUE" in insert_sql  # is_read=FALSE, is_dismissed=TRUE
    assert insert_params == ["n1", "user1"]


# ── mark_all_read ───────────────────────────────────────────────────────────


async def test_mark_all_read_update_then_insert(mock_conn):
    """mark_all_read: UPDATE существующих + INSERT недостающих state-строк."""
    mock_conn.execute.return_value = "UPDATE 0"
    repo = NotificationRepository(mock_conn)
    await repo.mark_all_read("user1")

    assert mock_conn.execute.call_count == 2
    update_sql, update_uid = mock_conn.execute.call_args_list[0].args
    assert "UPDATE notification_state" in update_sql
    assert "is_read = TRUE" in update_sql
    assert "is_dismissed = FALSE" in update_sql
    assert update_uid == "user1"

    insert_sql, insert_uid = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "NOT EXISTS" in insert_sql
    assert "recipient_user_id = $1 OR n.recipient_user_id IS NULL" in insert_sql
    # Регрессия: голый $1 в списке SELECT и $1 в сравнениях ниже выводят разные
    # типы (text vs varchar) → AmbiguousParameterError. Параметр приведён явно.
    assert "$1::varchar" in insert_sql
    assert insert_uid == "user1"


# ── create ──────────────────────────────────────────────────────────────────


async def test_create_inserts_and_returns_id(mock_conn):
    """create делает INSERT в notifications и возвращает id."""
    mock_conn.fetchval.return_value = "new-id"
    repo = NotificationRepository(mock_conn)
    result = await repo.create(
        id="new-id",
        source="manual",
        title="Заголовок",
        severity="warning",
        body="Тело",
        link="/constructor?act_id=42",
        element_ref="node-5",
        recipient_user_id="user2",
        created_by="user1",
    )

    sql, *params = mock_conn.fetchval.call_args.args
    assert "INSERT INTO notifications" in sql
    assert "RETURNING id" in sql
    assert params == [
        "new-id", "user2", "manual", "warning", "Заголовок",
        "Тело", "/constructor?act_id=42", "node-5", "user1",
    ]
    assert result == "new-id"


async def test_create_broadcast_recipient_none(mock_conn):
    """create с recipient_user_id=None → broadcast (NULL в параметре)."""
    mock_conn.fetchval.return_value = "bid"
    repo = NotificationRepository(mock_conn)
    await repo.create(id="bid", source="acts", title="Всем")

    _, *params = mock_conn.fetchval.call_args.args
    assert params[1] is None  # recipient_user_id
    assert params[8] == "system"  # created_by default
