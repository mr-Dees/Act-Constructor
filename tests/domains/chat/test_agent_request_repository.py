"""Тесты репозитория agent_requests (mock_conn)."""
import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.domains.chat.repositories.agent_request_repository import (
    AgentRequestRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


def _rid() -> str:
    return str(uuid.uuid4())


async def test_create_inserts_row_with_jsonb_fields(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    rid = _rid()
    await repo.create(
        id=rid,
        conversation_id="conv-1",
        message_id="msg-1",
        user_id="u",
        domain_name="acts",
        knowledge_bases=["acts_default"],
        last_user_message="Hello",
        history=[{"role": "user", "content": "Hello"}],
        files=[],
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "agent_requests" in sql
    # id, conversation_id, message_id, user_id, domain_name, knowledge_bases,
    # last_user_message, history, files — 9 параметров
    assert len(params) == 9
    assert params[0] == rid
    assert params[1] == "conv-1"
    # knowledge_bases / history / files передаются как JSON-строки
    assert json.loads(params[5]) == ["acts_default"]
    assert json.loads(params[7]) == [{"role": "user", "content": "Hello"}]
    assert json.loads(params[8]) == []


async def test_get_returns_parsed_jsonb_or_none(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchrow.return_value = {
        "id": "r1", "conversation_id": "c1", "message_id": "m1",
        "user_id": "u", "domain_name": "acts",
        "knowledge_bases": '["acts_default"]',
        "last_user_message": "Hello",
        "history": '[{"role":"user","content":"Hi"}]',
        "files": "[]",
        "status": "pending",
        "error_message": None,
        "created_at": None, "started_at": None, "finished_at": None,
    }
    row = await repo.get("r1")
    assert row is not None
    assert row["knowledge_bases"] == ["acts_default"]
    assert row["history"] == [{"role": "user", "content": "Hi"}]
    assert row["files"] == []
    assert row["status"] == "pending"


async def test_get_returns_none_when_missing(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchrow.return_value = None
    assert await repo.get("missing") is None


async def test_update_status_in_progress_sets_started_at(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = 1
    await repo.update_status("r1", status="in_progress")
    mock_conn.fetchval.assert_called_once()
    sql = mock_conn.fetchval.call_args.args[0]
    assert "UPDATE" in sql
    assert "started_at" in sql
    assert "status" in sql
    # version-инкремент и RETURNING — встроены в каждый update_status
    assert "version = version + 1" in sql
    assert "RETURNING version" in sql


async def test_update_status_done_sets_finished_at(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = 2
    await repo.update_status("r1", status="done")
    sql = mock_conn.fetchval.call_args.args[0]
    assert "finished_at" in sql
    assert "status" in sql


async def test_update_status_error_stores_message(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = 3
    await repo.update_status("r1", status="error", error_message="boom")
    args = mock_conn.fetchval.call_args.args
    sql = args[0]
    assert "finished_at" in sql
    assert "error_message" in sql
    assert "boom" in args


async def test_find_pending_returns_parsed_rows(mock_conn):
    """find_pending выбирает строки со status in (pending, in_progress),
    парсит JSONB-поля и сортирует по created_at."""
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {
            "id": "r1", "conversation_id": "c1", "message_id": "m1",
            "user_id": "u", "domain_name": None,
            "knowledge_bases": "[]", "last_user_message": "Q1",
            "history": "[]", "files": "[]",
            "status": "pending", "error_message": None,
            "created_at": None, "started_at": None, "finished_at": None,
        },
        {
            "id": "r2", "conversation_id": "c2", "message_id": "m2",
            "user_id": "u", "domain_name": "acts",
            "knowledge_bases": '["acts_default"]', "last_user_message": "Q2",
            "history": "[]", "files": "[]",
            "status": "in_progress", "error_message": None,
            "created_at": None, "started_at": None, "finished_at": None,
        },
    ]
    rows = await repo.find_pending(older_than_sec=30)

    # SQL отфильтровал по нужным статусам и параметру older_than_sec
    sql, *params = mock_conn.fetch.call_args.args
    assert "status IN ('pending', 'dispatched', 'in_progress')" in sql
    assert "interval '1 second'" in sql
    assert params == [30]

    # Возвращены распарсенные dict'ы (JSONB → Python)
    assert len(rows) == 2
    assert rows[0]["id"] == "r1"
    assert rows[0]["knowledge_bases"] == []
    assert rows[1]["knowledge_bases"] == ["acts_default"]


async def test_find_pending_returns_empty_list_when_no_rows(mock_conn):
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetch.return_value = []
    assert await repo.find_pending(older_than_sec=30) == []


# ── claim_pending: атомарный UPDATE ... RETURNING id ──────────────────────


async def test_claim_pending_atomicity(mock_conn):
    """claim_pending выполняет один атомарный UPDATE с RETURNING id.

    SQL должен:
      - быть UPDATE-statement-ом (не SELECT-then-UPDATE);
      - содержать RETURNING id;
      - фильтровать по worker_token IS NULL и нужным статусам;
      - использовать интервал в GP-совместимой форме.
    """
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetch.return_value = [
        {"id": "rid-1"}, {"id": "rid-2"},
    ]
    token = "worker-xyz"
    ids = await repo.claim_pending(worker_token=token, older_than_sec=30)

    # Один атомарный statement (без двойного round-trip SELECT+UPDATE).
    mock_conn.fetch.assert_called_once()
    sql, *params = mock_conn.fetch.call_args.args

    # Это именно UPDATE ... RETURNING id, не SELECT.
    assert "UPDATE" in sql
    assert "RETURNING id" in sql
    # SET worker_token и updated_at (для рестарт-window).
    assert "worker_token = $1" in sql
    assert "updated_at" in sql
    # WHERE-условия: NULL token + допустимые статусы + временной интервал.
    assert "worker_token IS NULL" in sql
    assert "status IN ('pending', 'dispatched')" in sql
    assert "interval '1 second'" in sql

    # Параметры — token и порог.
    assert params == [token, 30]
    # Возвращённые id — те, что вернул UPDATE.
    assert ids == ["rid-1", "rid-2"]


async def test_claim_pending_returns_empty_when_nothing_to_claim(mock_conn):
    """Если свободных строк нет — claim возвращает [], не падает."""
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetch.return_value = []
    assert await repo.claim_pending(worker_token="w", older_than_sec=30) == []


# ── update_status_versioned: optimistic locking ───────────────────────────


async def test_update_status_versioned_success_returns_new_version(mock_conn):
    """При совпадении версии — UPDATE проходит, version+1 возвращается."""
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = 5  # новая version после инкремента
    new_version = await repo.update_status(
        "r1", status="in_progress", expected_version=4,
    )
    assert new_version == 5

    sql, *params = mock_conn.fetchval.call_args.args
    assert "UPDATE" in sql
    assert "version = version + 1" in sql
    assert "AND version = $" in sql
    assert "RETURNING version" in sql
    # expected_version пришёл последним параметром.
    assert params[-1] == 4


async def test_update_status_versioned_conflict_returns_none(mock_conn):
    """При несовпадении версии (никакая строка не обновилась) — None."""
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = None  # asyncpg вернёт NULL
    new_version = await repo.update_status(
        "r1", status="done", expected_version=999, error_message=None,
    )
    assert new_version is None

    sql = mock_conn.fetchval.call_args.args[0]
    assert "AND version = $" in sql
    assert "RETURNING version" in sql


async def test_update_status_without_expected_version_still_returns_version(
    mock_conn,
):
    """Без expected_version SQL без AND version = ..., но RETURNING version
    остаётся — вызывающий получает новую версию для последующих апдейтов."""
    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = 1
    new_version = await repo.update_status("r1", status="in_progress")
    assert new_version == 1
    sql = mock_conn.fetchval.call_args.args[0]
    assert "AND version = $" not in sql
    assert "RETURNING version" in sql


async def test_update_status_version_conflict_logs_context(mock_conn, caplog):
    """1.9: При version-conflict warning содержит current_version и status.

    Репозиторий обязан подсветить, кто перебил версию, чтобы при разборе
    инцидентов в логах было видно конкурентов.
    """
    import logging as _logging

    repo = AgentRequestRepository(mock_conn)
    mock_conn.fetchval.return_value = None  # version conflict
    mock_conn.fetchrow.return_value = {
        "version": 7,
        "status": "in_progress",
        "worker_token": "worker-abc",
    }

    with caplog.at_level(_logging.WARNING):
        result = await repo.update_status(
            "r-conflict", status="done", expected_version=3,
        )

    assert result is None
    # Должны увидеть и expected_version, и current_version, и worker_token
    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert "r-conflict" in log_text
    assert "expected_version=3" in log_text
    assert "current_version=7" in log_text
    assert "current_status=in_progress" in log_text
    assert "worker-abc" in log_text
