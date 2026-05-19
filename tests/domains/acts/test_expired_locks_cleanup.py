"""Тесты ExpiredLocksCleanupTask — фоновая очистка просроченных блокировок актов.

Покрывает: периодический вызов UPDATE, парсинг asyncpg-tag 'UPDATE N',
INFO-лог раз в N циклов, корректный stop().
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.acts.services.expired_locks_cleanup import ExpiredLocksCleanupTask


def _patch_db(mock_conn, mock_adapter):
    """Контекстный менеджер: подменяет get_db и get_adapter."""
    class _DBCtx:
        async def __aenter__(self_inner):
            return mock_conn
        async def __aexit__(self_inner, *exc):
            return False

    return patch.multiple(
        "app.domains.acts.services.expired_locks_cleanup",
        get_db=MagicMock(return_value=_DBCtx()),
        get_adapter=MagicMock(return_value=mock_adapter),
    )


async def test_cleanup_runs_periodically(mock_conn, mock_adapter):
    """UPDATE вызывается каждый interval_sec и парсит число затронутых строк."""
    mock_conn.execute = AsyncMock(return_value="UPDATE 3")
    with _patch_db(mock_conn, mock_adapter):
        task = ExpiredLocksCleanupTask(
            interval_sec=0.02, log_every_n_cycles=100,
        )
        await task.start()
        # Даём минимум 2 цикла
        await asyncio.sleep(0.07)
        await task.stop()

    # Должно быть ≥2 вызова UPDATE
    assert mock_conn.execute.call_count >= 2
    sql = mock_conn.execute.call_args_list[0].args[0]
    assert "UPDATE" in sql
    assert "lock_expires_at" in sql
    assert "locked_by IS NOT NULL" in sql


async def test_cleanup_parses_update_command_tag(mock_conn, mock_adapter):
    """asyncpg возвращает 'UPDATE N' — счётчик корректно извлекается."""
    mock_conn.execute = AsyncMock(return_value="UPDATE 7")
    with _patch_db(mock_conn, mock_adapter):
        task = ExpiredLocksCleanupTask(interval_sec=0.02, log_every_n_cycles=100)
        cleaned = await task._cleanup_once()
    assert cleaned == 7


async def test_cleanup_parse_zero_on_malformed_tag(mock_conn, mock_adapter):
    """Если command-tag не парсится — 0 (без падений)."""
    mock_conn.execute = AsyncMock(return_value="ERROR garbled")
    with _patch_db(mock_conn, mock_adapter):
        task = ExpiredLocksCleanupTask(interval_sec=0.02, log_every_n_cycles=100)
        cleaned = await task._cleanup_once()
    assert cleaned == 0


async def test_cleanup_logs_summary_every_n_cycles(mock_conn, mock_adapter, caplog):
    """После N циклов в INFO-лог пишется суммарная статистика."""
    mock_conn.execute = AsyncMock(return_value="UPDATE 2")
    with _patch_db(mock_conn, mock_adapter):
        with caplog.at_level("INFO"):
            task = ExpiredLocksCleanupTask(
                interval_sec=0.01, log_every_n_cycles=3,
            )
            await task.start()
            # Дожидаемся минимум 3 циклов (≥0.03с)
            await asyncio.sleep(0.07)
            await task.stop()

    summary_records = [
        r for r in caplog.records
        if "Очистка просроченных блокировок актов" in r.getMessage()
    ]
    assert summary_records, "INFO-лог о суммарной статистике не появился"
    # Сообщение содержит число снятых блокировок
    msg = summary_records[0].getMessage()
    assert "снято" in msg


async def test_cleanup_stop_cancels_task(mock_conn, mock_adapter):
    """stop() отменяет фоновую задачу; повторный stop() — no-op."""
    mock_conn.execute = AsyncMock(return_value="UPDATE 0")
    with _patch_db(mock_conn, mock_adapter):
        task = ExpiredLocksCleanupTask(
            interval_sec=10.0,  # длинный, чтобы не было лишних циклов
            log_every_n_cycles=100,
        )
        await task.start()
        assert task._task is not None
        await task.stop()
        assert task._task is None
        # Повторный stop — без ошибок
        await task.stop()


async def test_cleanup_start_idempotent(mock_conn, mock_adapter):
    """Повторный start() не создаёт второй task."""
    mock_conn.execute = AsyncMock(return_value="UPDATE 0")
    with _patch_db(mock_conn, mock_adapter):
        task = ExpiredLocksCleanupTask(interval_sec=10.0, log_every_n_cycles=100)
        await task.start()
        t1 = task._task
        await task.start()
        t2 = task._task
        assert t1 is t2
        await task.stop()


async def test_cleanup_swallows_exception_and_continues(
    mock_conn, mock_adapter, caplog,
):
    """Исключение в UPDATE не убивает фоновый цикл — логируется и продолжаем."""
    # Первый вызов — раз/два падает, дальше — успех.
    mock_conn.execute = AsyncMock(side_effect=[
        RuntimeError("DB hiccup"),
        "UPDATE 1",
        "UPDATE 0",
    ])
    with _patch_db(mock_conn, mock_adapter):
        with caplog.at_level("ERROR"):
            task = ExpiredLocksCleanupTask(
                interval_sec=0.01, log_every_n_cycles=100,
            )
            await task.start()
            await asyncio.sleep(0.05)
            await task.stop()

    # Был хотя бы один error-лог
    error_msgs = [
        r for r in caplog.records
        if "Ошибка фонового цикла очистки" in r.getMessage()
    ]
    assert error_msgs
    # И при этом мы успели сделать ≥2 запроса (цикл продолжился)
    assert mock_conn.execute.call_count >= 2
