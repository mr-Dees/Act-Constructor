"""Тесты репозитория центра уведомлений.

Покрывают: list_for_user (LEFT JOIN state, broadcast-видимость, скрытие
dismissed, COALESCE is_read), unread_summary (count + max-severity), _visible_clause,
mark_read/dismiss (lazy upsert: UPDATE; если 0 строк — INSERT), mark_all_read,
create. Стратегия: mock_conn + autouse-патч get_adapter — как в
tests/domains/chat/test_message_repository.py.
"""

from unittest.mock import MagicMock, patch

import pytest

from app.domains.notifications.exceptions import NotificationNotFoundError
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


# ── _visible_clause (единый предикат видимости) ──────────────────────────────


def test_visible_clause_equivalent_to_inlined_predicates():
    """_visible_clause воспроизводит прежние 4 инлайн-предиката (без дрейфа SQL)."""
    # list/count/mark_all_read: алиас n, $1, без приведения
    assert (
        NotificationRepository._visible_clause(1, alias="n")
        == "(n.recipient_user_id = $1 OR n.recipient_user_id IS NULL)"
    )
    # _is_visible_to_user: без алиаса, $2, приведение ::varchar
    assert (
        NotificationRepository._visible_clause(2, cast="::varchar")
        == "(recipient_user_id = $2::varchar OR recipient_user_id IS NULL)"
    )


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


# ── unread_summary ──────────────────────────────────────────────────────────


async def test_unread_summary_query_and_value(mock_conn):
    """unread_summary считает непрочитанные видимые и их max-severity одним запросом."""
    mock_conn.fetchrow.return_value = {"count": 3, "sev_rank": 3}
    repo = NotificationRepository(mock_conn)
    result = await repo.unread_summary("user1")

    sql, user_id = mock_conn.fetchrow.call_args.args
    assert "COUNT(*) AS count" in sql
    assert "AS sev_rank" in sql
    # max-severity через CASE-ранжир (error>warning>info>прочее)
    assert "WHEN 'error' THEN 3" in sql
    assert "WHEN 'warning' THEN 2" in sql
    assert "WHEN 'info' THEN 1" in sql
    assert "COALESCE(s.is_read, FALSE) = FALSE" in sql
    assert "COALESCE(s.is_dismissed, FALSE) = FALSE" in sql
    assert user_id == "user1"
    assert result == {"count": 3, "severity": "error"}


async def test_unread_summary_max_severity_mapping(mock_conn):
    """sev_rank → строка: 3→error, 2→warning, 1→info, 0→None."""
    repo = NotificationRepository(mock_conn)
    for rank, expected in [(3, "error"), (2, "warning"), (1, "info"), (0, None)]:
        mock_conn.fetchrow.return_value = {"count": 2, "sev_rank": rank}
        result = await repo.unread_summary("user1")
        assert result == {"count": 2, "severity": expected}


async def test_unread_summary_no_unread_severity_none(mock_conn):
    """Непрочитанных нет: count=0, sev_rank=NULL → severity None."""
    mock_conn.fetchrow.return_value = {"count": 0, "sev_rank": None}
    repo = NotificationRepository(mock_conn)
    assert await repo.unread_summary("user1") == {"count": 0, "severity": None}


async def test_unread_summary_none_row_returns_zero(mock_conn):
    """unread_summary устойчив к None-строке: count=0, severity None."""
    mock_conn.fetchrow.return_value = None
    repo = NotificationRepository(mock_conn)
    assert await repo.unread_summary("user1") == {"count": 0, "severity": None}


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
    """mark_read: если UPDATE затронул 0 строк — лениво создаётся state INSERT'ом.

    Перед INSERT идёт fetchval(EXISTS) — проверка видимости уведомления; для
    видимого она возвращает True и INSERT выполняется.
    """
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    mock_conn.fetchval.return_value = True
    repo = NotificationRepository(mock_conn)
    await repo.mark_read("n1", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *insert_params = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "TRUE, FALSE" in insert_sql  # is_read=TRUE, is_dismissed=FALSE
    assert insert_params == ["n1", "user1"]


async def test_mark_read_raises_404_when_not_visible(mock_conn):
    """mark_read: UPDATE 0 и невидимое уведомление → NotificationNotFoundError, без INSERT."""
    mock_conn.execute.side_effect = ["UPDATE 0"]
    mock_conn.fetchval.return_value = False
    repo = NotificationRepository(mock_conn)

    with pytest.raises(NotificationNotFoundError) as exc_info:
        await repo.mark_read("ghost", "user1")

    assert exc_info.value.status_code == 404
    # INSERT не выполнен — был только UPDATE (1 вызов execute).
    assert mock_conn.execute.call_count == 1
    # Проверка видимости: EXISTS с приведением ::varchar (как в mark_all_read).
    exists_sql, *exists_params = mock_conn.fetchval.call_args.args
    assert "EXISTS" in exists_sql
    assert "recipient_user_id = $2::varchar OR recipient_user_id IS NULL" in exists_sql
    assert exists_params == ["ghost", "user1"]


# ── mark_unread (lazy upsert, зеркало mark_read) ────────────────────────────


async def test_mark_unread_updates_existing_state(mock_conn):
    """mark_unread: UPDATE затронул строку — без INSERT, is_read=FALSE."""
    mock_conn.execute.return_value = "UPDATE 1"
    repo = NotificationRepository(mock_conn)
    await repo.mark_unread("n1", "user1")

    assert mock_conn.execute.call_count == 1
    sql, nid, uid = mock_conn.execute.call_args.args
    assert "UPDATE notification_state" in sql
    assert "is_read = FALSE" in sql
    assert "updated_at = CURRENT_TIMESTAMP" in sql
    assert nid == "n1"
    assert uid == "user1"


async def test_mark_unread_inserts_when_no_state(mock_conn):
    """mark_unread: UPDATE 0 → fetchval(EXISTS)=True → INSERT с is_read=FALSE."""
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    mock_conn.fetchval.return_value = True
    repo = NotificationRepository(mock_conn)
    await repo.mark_unread("n1", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *insert_params = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "FALSE, FALSE" in insert_sql  # is_read=FALSE, is_dismissed=FALSE
    assert insert_params == ["n1", "user1"]


async def test_mark_unread_raises_404_when_not_visible(mock_conn):
    """mark_unread: UPDATE 0 и невидимое уведомление → 404, без INSERT."""
    mock_conn.execute.side_effect = ["UPDATE 0"]
    mock_conn.fetchval.return_value = False
    repo = NotificationRepository(mock_conn)

    with pytest.raises(NotificationNotFoundError) as exc_info:
        await repo.mark_unread("ghost", "user1")

    assert exc_info.value.status_code == 404
    assert mock_conn.execute.call_count == 1


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
    """dismiss: UPDATE 0 → fetchval(EXISTS)=True → INSERT с is_dismissed=TRUE."""
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    mock_conn.fetchval.return_value = True
    repo = NotificationRepository(mock_conn)
    await repo.dismiss("n1", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *insert_params = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql
    assert "FALSE, TRUE" in insert_sql  # is_read=FALSE, is_dismissed=TRUE
    assert insert_params == ["n1", "user1"]


async def test_dismiss_raises_404_when_not_visible(mock_conn):
    """dismiss: UPDATE 0 и невидимое уведомление → NotificationNotFoundError, без INSERT."""
    mock_conn.execute.side_effect = ["UPDATE 0"]
    mock_conn.fetchval.return_value = False
    repo = NotificationRepository(mock_conn)

    with pytest.raises(NotificationNotFoundError) as exc_info:
        await repo.dismiss("ghost", "user1")

    assert exc_info.value.status_code == 404
    assert mock_conn.execute.call_count == 1


async def test_dismiss_broadcast_visible_inserts(mock_conn):
    """dismiss: broadcast (recipient NULL) видим → fetchval=True → INSERT происходит.

    Видимость через EXISTS покрывает и broadcast (recipient_user_id IS NULL),
    поэтому скрытие broadcast-уведомления создаёт state, а не падает 404.
    """
    mock_conn.execute.side_effect = ["UPDATE 0", "INSERT 0 1"]
    mock_conn.fetchval.return_value = True
    repo = NotificationRepository(mock_conn)
    await repo.dismiss("broadcast-id", "user1")

    assert mock_conn.execute.call_count == 2
    insert_sql, *_ = mock_conn.execute.call_args_list[1].args
    assert "INSERT INTO notification_state" in insert_sql


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
