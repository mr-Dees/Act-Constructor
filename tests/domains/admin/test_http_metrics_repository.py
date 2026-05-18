"""Тесты репозитория admin_http_metrics (mock_conn)."""

from unittest.mock import MagicMock, patch

import pytest

from app.domains.admin.repositories.http_metrics_repository import (
    HttpMetricsRepository,
)


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


async def test_record_inserts_all_fields(mock_conn):
    """Запись прокидывает все поля в INSERT в правильном порядке."""
    repo = HttpMetricsRepository(mock_conn)
    await repo.record(
        method="GET",
        path="/api/v1/acts",
        status_code=200,
        latency_ms=42,
        username="22494524",
        request_id="abc12345",
    )
    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "INSERT INTO" in sql
    assert "admin_http_metrics" in sql
    assert len(params) == 6
    assert params[0] == "GET"
    assert params[1] == "/api/v1/acts"
    assert params[2] == 200
    assert params[3] == 42
    assert params[4] == "22494524"
    assert params[5] == "abc12345"


async def test_record_with_null_username(mock_conn):
    """Username может быть NULL — для unauthenticated/health запросов."""
    repo = HttpMetricsRepository(mock_conn)
    await repo.record(
        method="GET",
        path="/health",
        status_code=200,
        latency_ms=3,
        username=None,
        request_id="req-1",
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[4] is None


async def test_record_with_null_request_id(mock_conn):
    """request_id может быть NULL — если middleware ещё не выставил."""
    repo = HttpMetricsRepository(mock_conn)
    await repo.record(
        method="POST",
        path="/api/v1/acts",
        status_code=201,
        latency_ms=120,
        username="22494524",
        request_id=None,
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[5] is None


@pytest.mark.parametrize("status", [200, 301, 400, 404, 500, 503])
async def test_record_various_status_codes(mock_conn, status):
    """Разные status_code (включая 5xx) корректно сохраняются."""
    repo = HttpMetricsRepository(mock_conn)
    await repo.record(
        method="GET",
        path="/api/v1/test",
        status_code=status,
        latency_ms=10,
        username=None,
        request_id=None,
    )
    sql, *params = mock_conn.execute.call_args.args
    assert params[2] == status


async def test_record_propagates_db_error(mock_conn):
    """Репозиторий НЕ глушит исключение — это делает сервис-фасад."""
    mock_conn.execute.side_effect = RuntimeError("DB unavailable")
    repo = HttpMetricsRepository(mock_conn)
    with pytest.raises(RuntimeError, match="DB unavailable"):
        await repo.record(
            method="GET",
            path="/api/v1/test",
            status_code=200,
            latency_ms=10,
            username=None,
            request_id=None,
        )


async def test_record_many_executes_executemany(mock_conn):
    """Bulk-INSERT: один executemany с правильным списком кортежей."""
    from app.domains.admin.repositories.http_metrics_repository import (
        HttpMetricRecord,
    )

    repo = HttpMetricsRepository(mock_conn)
    records = [
        HttpMetricRecord(
            method="GET",
            path="/api/v1/a",
            status_code=200,
            latency_ms=10,
            username="u1",
            request_id="r1",
        ),
        HttpMetricRecord(
            method="POST",
            path="/api/v1/b",
            status_code=201,
            latency_ms=20,
            username=None,
            request_id=None,
        ),
    ]
    await repo.record_many(records)
    mock_conn.executemany.assert_awaited_once()
    sql, params = mock_conn.executemany.call_args.args
    assert "INSERT INTO" in sql
    assert "admin_http_metrics" in sql
    assert params == [
        ("GET", "/api/v1/a", 200, 10, "u1", "r1"),
        ("POST", "/api/v1/b", 201, 20, None, None),
    ]


async def test_record_many_empty_is_noop(mock_conn):
    """Пустой список — не вызывается executemany, не открывается транзакция."""
    repo = HttpMetricsRepository(mock_conn)
    await repo.record_many([])
    mock_conn.executemany.assert_not_called()
    mock_conn.transaction.assert_not_called()
