"""Тесты lifespan-reconcile моста к внешнему ИИ-агенту.

Покрывают атомарный claim (4.11): после рестарта uvicorn ровно один воркер
подхватывает зависшие в pending/dispatched запросы; повторный reconcile
не плодит дубли polling-задач.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.services import agent_bridge_runner
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clean_registries():
    """Сброс глобального состояния реестров и runner-registry."""
    reset_registry()
    reset_settings()
    reset_tools()
    agent_bridge_runner._running.clear()
    yield
    # Не вызываем .cancel() здесь: фикстура синхронная и срабатывает
    # после закрытия event loop, поэтому call_soon() ругается на
    # "Event loop is closed". Тест сам ответственен за отмену живых
    # задач до выхода — см. helper _cancel_running_tasks ниже.
    agent_bridge_runner._running.clear()
    reset_registry()
    reset_settings()
    reset_tools()


async def _cancel_running_tasks():
    """Снимает все живые задачи раннера в текущем event loop."""
    tasks = [t for t in agent_bridge_runner._running.values() if not t.done()]
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
    agent_bridge_runner._running.clear()


def _settings() -> ChatDomainSettings:
    s = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
    )
    s.agent_bridge.poll_interval_sec = 0.01
    s.agent_bridge.initial_response_timeout_sec = 5
    s.agent_bridge.event_timeout_sec = 5
    s.agent_bridge.max_total_duration_sec = 5
    return s


def _fake_get_db_ctx(conn):
    """get_db()-фабрика, возвращающая контекст-менеджер с моком conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


# -------------------------------------------------------------------------
# Тест 1: schedule_pending дотягивает только старые pending и не плодит
# дубли задач при повторном reconcile.
# -------------------------------------------------------------------------


async def test_schedule_pending_claims_only_old():
    """Первый reconcile стартует фоновую задачу для каждого pending-id,
    второй reconcile (когда у репозитория пусто) не плодит новые задачи и
    не запускает повторный schedule для уже бегущих id.
    """
    mock_conn = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    fake_req_repo = MagicMock()
    # Первый claim отдаёт два pending-id; второй — пусто (уже заклеймлены
    # этим воркером, новый claim видит worker_token IS NOT NULL).
    fake_req_repo.claim_pending = AsyncMock(
        side_effect=[
            ["rid-1", "rid-2"],
            [],
        ],
    )

    # _run должен висеть до отмены, чтобы задача считалась "живой" между
    # двумя вызовами schedule_pending.
    started = asyncio.Event()

    async def fake_run(_rid, *, settings):  # noqa: ARG001
        started.set()
        await asyncio.sleep(10)

    with (
        patch("app.db.connection.get_db", _fake_get_db_ctx(mock_conn)),
        patch(
            "app.db.repositories.base.get_adapter",
            return_value=fake_adapter,
        ),
        patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository",
            return_value=fake_req_repo,
        ),
        patch.object(agent_bridge_runner, "_run", fake_run),
    ):
        # Первый reconcile: заклеймлены rid-1 и rid-2 — стартуют 2 задачи.
        count1 = await agent_bridge_runner.schedule_pending(
            settings=_settings(), older_than_sec=30,
        )
        # Дожидаемся, что хотя бы одна из задач реально вошла в _run
        # (иначе race: registry уже заполнен, но done_callback ещё не сработал).
        await asyncio.wait_for(started.wait(), timeout=1.0)

        assert count1 == 2
        assert set(agent_bridge_runner._running.keys()) == {"rid-1", "rid-2"}

        # Второй reconcile: репозиторий говорит "никого не осталось".
        # Это семантика атомарного claim: уже заклеймленные строки в
        # выборку повторно не попадают.
        count2 = await agent_bridge_runner.schedule_pending(
            settings=_settings(), older_than_sec=30,
        )

        assert count2 == 0
        # Registry не разрастается — те же 2 живые задачи.
        assert set(agent_bridge_runner._running.keys()) == {"rid-1", "rid-2"}

    # claim_pending звался дважды (по разу на каждый reconcile).
    assert fake_req_repo.claim_pending.await_count == 2
    # И именно с переданным порогом — не дефолтным.
    for call_obj in fake_req_repo.claim_pending.await_args_list:
        assert call_obj.kwargs.get("older_than_sec") == 30

    # Снимаем фоновые задачи до выхода из теста (sync-фикстура этого не делает).
    await _cancel_running_tasks()


# -------------------------------------------------------------------------
# Тест 2: SQL у claim_pending включает worker_token IS NULL и
# status IN ('pending', 'dispatched') — атомарный UPDATE...RETURNING,
# не подхватывает работающие воркеры.
# -------------------------------------------------------------------------


_HAS_CLAIM_PENDING = hasattr(
    __import__(
        "app.domains.chat.repositories.agent_request_repository",
        fromlist=["AgentRequestRepository"],
    ).AgentRequestRepository,
    "claim_pending",
)


@pytest.mark.skipif(
    not _HAS_CLAIM_PENDING,
    reason="Зависит от agent_bridge claim API (claim_pending ещё не добавлен)",
)
async def test_claim_pending_atomic_excludes_active_workers(mock_conn, mock_adapter):
    """SQL claim_pending должен:

    * фильтровать worker_token IS NULL — чтобы не перехватывать строки,
      которые уже клеймил другой воркер;
    * брать только status IN ('pending', 'dispatched') — финализированные
      и работающие in_progress строки не должны перезапускаться;
    * выполняться одним UPDATE...RETURNING — атомарно, без CTE.
    """
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )

    mock_conn.fetch = AsyncMock(return_value=[])

    with patch(
        "app.db.repositories.base.get_adapter",
        return_value=mock_adapter,
    ):
        repo = AgentRequestRepository(mock_conn)
        result = await repo.claim_pending("worker-A", older_than_sec=30)

    assert result == []
    mock_conn.fetch.assert_awaited_once()

    # Извлекаем SQL — первым позиционным аргументом fetch().
    call_args = mock_conn.fetch.await_args
    sql = call_args.args[0]
    params = call_args.args[1:]

    # SQL должен быть UPDATE...RETURNING (атомарный claim в один statement).
    assert "UPDATE" in sql.upper()
    assert "RETURNING" in sql.upper()
    # Не должно быть CTE (несовместимо с GP 6 для DML) и ON CONFLICT.
    assert "WITH " not in sql.upper().replace("WHERE ", "")
    assert "ON CONFLICT" not in sql.upper()

    # Ключевые условия фильтра.
    normalized = " ".join(sql.split())  # схлопываем переносы и пробелы
    assert "worker_token IS NULL" in normalized
    assert "status IN ('pending', 'dispatched')" in normalized

    # Параметры: worker_token первым, порог секунд вторым.
    assert params[0] == "worker-A"
    assert params[1] == 30
