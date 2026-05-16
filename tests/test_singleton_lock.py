"""Тесты singleton-блокировки инстанса приложения.

Логика проверяется на уровне функций acquire/release с моком соединения.
Реальная БД не нужна — нам важно поведение SQL-вызовов и веток
fresh-lock / stale-lock / busy.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest

from app.core.singleton_lock import (
    DEFAULT_STALE_TTL_SEC,
    SERVICE_NAME,
    SingletonLockBusyError,
    acquire_singleton_lock,
    release_singleton_lock,
)


@pytest.fixture
def mock_conn():
    """Mock asyncpg.Connection с поддержкой транзакций."""
    conn = AsyncMock()
    conn.execute = AsyncMock()
    conn.fetchrow = AsyncMock()

    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


class TestAcquireSingletonLock:
    """Поведение acquire_singleton_lock в трёх сценариях."""

    async def test_fresh_lock_inserted(self, mock_conn):
        """Если строки нет — выполняется чистый INSERT."""
        mock_conn.execute.return_value = "INSERT 0 1"

        await acquire_singleton_lock(mock_conn, "app_singleton_lock")

        # Был ровно один execute — INSERT
        assert mock_conn.execute.await_count == 1
        sql = mock_conn.execute.await_args_list[0].args[0]
        assert "INSERT INTO app_singleton_lock" in sql
        # fetchrow не вызывался: нет конфликта — нет проверки stale
        mock_conn.fetchrow.assert_not_awaited()

    async def test_busy_fresh_lock_raises(self, mock_conn):
        """Lock держит свежий воркер (age < TTL) — RuntimeError."""
        mock_conn.execute.side_effect = asyncpg.UniqueViolationError(
            "duplicate key value",
        )
        mock_conn.fetchrow.return_value = {
            "pid": 12345,
            "host": "other-host",
            "started_at": "2026-05-14",
            "age_sec": 10,  # свежий, меньше TTL=60
        }

        with pytest.raises(SingletonLockBusyError) as exc_info:
            await acquire_singleton_lock(mock_conn, "app_singleton_lock")

        assert "уже запущена" in str(exc_info.value).lower()
        assert "12345" in str(exc_info.value)
        # Перезаписи не было — повторного INSERT нет
        assert mock_conn.execute.await_count == 1

    async def test_stale_lock_overwritten(self, mock_conn):
        """Lock старше TTL — перезаписываем DELETE+INSERT в транзакции."""
        # Первый INSERT падает с конфликтом
        # Затем DELETE и повторный INSERT успешны
        mock_conn.execute.side_effect = [
            asyncpg.UniqueViolationError("duplicate key value"),
            "DELETE 1",
            "INSERT 0 1",
        ]
        mock_conn.fetchrow.return_value = {
            "pid": 99,
            "host": "dead-host",
            "started_at": "2026-05-13",
            "age_sec": DEFAULT_STALE_TTL_SEC + 5,
        }

        await acquire_singleton_lock(mock_conn, "app_singleton_lock")

        # 1 первоначальный INSERT + DELETE + повторный INSERT = 3 execute
        assert mock_conn.execute.await_count == 3
        sqls = [call.args[0] for call in mock_conn.execute.await_args_list]
        assert "INSERT" in sqls[0]
        assert "DELETE" in sqls[1]
        assert "INSERT" in sqls[2]
        # Транзакция использовалась для DELETE+INSERT
        assert mock_conn.transaction.called

    async def test_custom_service_name(self, mock_conn):
        """service_name пробрасывается в параметры запроса."""
        mock_conn.execute.return_value = "INSERT 0 1"

        await acquire_singleton_lock(
            mock_conn, "app_singleton_lock", service_name="custom_svc",
        )

        args = mock_conn.execute.await_args_list[0].args
        # $1 = service_name
        assert args[1] == "custom_svc"

    async def test_default_service_name_is_act_constructor(self):
        """Дефолтное имя сервиса — act_constructor."""
        assert SERVICE_NAME == "act_constructor"


class TestReleaseSingletonLock:
    """Поведение release_singleton_lock."""

    async def test_delete_by_pid(self, mock_conn):
        """release_singleton_lock делает DELETE с фильтром по своему PID."""
        mock_conn.execute.return_value = "DELETE 1"

        await release_singleton_lock(mock_conn, "app_singleton_lock")

        assert mock_conn.execute.await_count == 1
        sql = mock_conn.execute.await_args_list[0].args[0]
        assert "DELETE FROM app_singleton_lock" in sql
        assert "pid = $2" in sql

    async def test_release_swallows_exception(self, mock_conn):
        """Ошибка в DELETE не пробрасывается наружу (best-effort)."""
        mock_conn.execute.side_effect = Exception("network down")

        # Не должно бросить
        await release_singleton_lock(mock_conn, "app_singleton_lock")
