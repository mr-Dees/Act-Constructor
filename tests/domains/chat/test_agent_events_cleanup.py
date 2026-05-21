"""Тесты AgentEventsCleanupTask — фоновая очистка устаревших
agent_response_events для done-запросов.

Покрывает: периодический вызов DELETE, парсинг asyncpg-tag 'DELETE N',
INFO-лог раз в N циклов, корректный stop(), отлов ошибок без падения цикла.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.chat.services.agent_events_cleanup import (
    AgentEventsCleanupTask,
)


def _patch_db(mock_conn, mock_adapter):
    """Контекстный менеджер: подменяет get_db и get_adapter."""
    class _DBCtx:
        async def __aenter__(self_inner):
            return mock_conn
        async def __aexit__(self_inner, *exc):
            return False

    return patch.multiple(
        "app.domains.chat.services.agent_events_cleanup",
        get_db=MagicMock(return_value=_DBCtx()),
        get_adapter=MagicMock(return_value=mock_adapter),
    )


async def test_cleanup_runs_delete_with_correct_params(mock_conn, mock_adapter):
    """DELETE вызывается с правильным SQL и ttl_hours-параметром."""
    mock_conn.execute = AsyncMock(return_value="DELETE 5")
    with _patch_db(mock_conn, mock_adapter):
        task = AgentEventsCleanupTask(
            interval_sec=0.02, ttl_hours=12, log_every_n_cycles=100,
        )
        await task.start()
        await asyncio.sleep(0.07)
        await task.stop()

    assert mock_conn.execute.call_count >= 2
    sql = mock_conn.execute.call_args_list[0].args[0]
    assert "DELETE FROM" in sql
    assert "agent_response_events" in sql
    assert "agent_requests" in sql
    assert "status = 'done'" in sql
    # ttl-параметр пробрасывается как '12 hours'.
    param = mock_conn.execute.call_args_list[0].args[1]
    assert param == "12 hours"


async def test_cleanup_parses_delete_command_tag(mock_conn, mock_adapter):
    """asyncpg возвращает 'DELETE N' — счётчик корректно извлекается."""
    mock_conn.execute = AsyncMock(return_value="DELETE 42")
    with _patch_db(mock_conn, mock_adapter):
        task = AgentEventsCleanupTask(
            interval_sec=10.0, ttl_hours=24, log_every_n_cycles=100,
        )
        deleted = await task._cleanup_once()
    assert deleted == 42


async def test_cleanup_parse_zero_on_malformed_tag(mock_conn, mock_adapter):
    """Если command-tag не парсится — 0 (без падений)."""
    mock_conn.execute = AsyncMock(return_value="ERROR garbled")
    with _patch_db(mock_conn, mock_adapter):
        task = AgentEventsCleanupTask(
            interval_sec=10.0, ttl_hours=24, log_every_n_cycles=100,
        )
        deleted = await task._cleanup_once()
    assert deleted == 0


async def test_cleanup_logs_count_periodically(
    mock_conn, mock_adapter, caplog,
):
    """После N циклов в INFO-лог пишется суммарная статистика."""
    mock_conn.execute = AsyncMock(return_value="DELETE 3")
    with _patch_db(mock_conn, mock_adapter):
        with caplog.at_level("INFO"):
            task = AgentEventsCleanupTask(
                interval_sec=0.01, ttl_hours=24, log_every_n_cycles=2,
            )
            await task.start()
            await asyncio.sleep(0.07)
            await task.stop()

    summary_records = [
        r for r in caplog.records
        if "Очистка agent_response_events" in r.getMessage()
    ]
    assert summary_records, (
        "INFO-лог о суммарной статистике не появился"
    )
    msg = summary_records[0].getMessage()
    assert "удалено" in msg
    assert "ttl_hours=24" in msg


async def test_cleanup_handles_db_errors_gracefully(
    mock_conn, mock_adapter, caplog,
):
    """Исключение в DELETE не убивает фоновый цикл — логируется и
    продолжаем."""
    mock_conn.execute = AsyncMock(side_effect=[
        RuntimeError("DB hiccup"),
        "DELETE 1",
        "DELETE 0",
    ])
    with _patch_db(mock_conn, mock_adapter):
        with caplog.at_level("ERROR"):
            task = AgentEventsCleanupTask(
                interval_sec=0.01, ttl_hours=24, log_every_n_cycles=100,
            )
            await task.start()
            await asyncio.sleep(0.05)
            await task.stop()

    error_msgs = [
        r for r in caplog.records
        if "Ошибка фонового цикла очистки" in r.getMessage()
    ]
    assert error_msgs
    assert mock_conn.execute.call_count >= 2


async def test_cleanup_cancellable(mock_conn, mock_adapter):
    """stop() отменяет фоновую задачу; повторный stop() — no-op."""
    mock_conn.execute = AsyncMock(return_value="DELETE 0")
    with _patch_db(mock_conn, mock_adapter):
        task = AgentEventsCleanupTask(
            interval_sec=10.0, ttl_hours=24, log_every_n_cycles=100,
        )
        await task.start()
        assert task._task is not None
        await task.stop()
        assert task._task is None
        # Повторный stop — без ошибок.
        await task.stop()


async def test_cleanup_start_idempotent(mock_conn, mock_adapter):
    """Повторный start() не создаёт второй task."""
    mock_conn.execute = AsyncMock(return_value="DELETE 0")
    with _patch_db(mock_conn, mock_adapter):
        task = AgentEventsCleanupTask(
            interval_sec=10.0, ttl_hours=24, log_every_n_cycles=100,
        )
        await task.start()
        t1 = task._task
        await task.start()
        t2 = task._task
        assert t1 is t2
        await task.stop()
