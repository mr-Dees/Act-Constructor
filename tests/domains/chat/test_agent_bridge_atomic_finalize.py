"""Тесты атомарного финализа agent_bridge_runner.

Покрывает три сценария:

1. Оптимистичная блокировка: finalize возвращает False (другой воркер
   уже финализировал) → OptimisticLockFailed → транзакция откатывается →
   save_assistant_message не сохраняет данные в БД.

2. Race-симуляция: два параллельных _run на одну agent_request, один
   побеждает (finalize=True), второй проигрывает (finalize=False).
   После этого в conversation ровно 1 ассистент-сообщение.

3. Успешная финализация: save + finalize в транзакции, статус 'done'.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.chat.services import agent_bridge_runner
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _reset_registry():
    """Очищает глобальный реестр раннера между тестами."""
    agent_bridge_runner._running.clear()
    yield
    for t in list(agent_bridge_runner._running.values()):
        if not t.done():
            t.cancel()
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
    """get_db()-фабрика, возвращающая async context manager с mock conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


def _make_mock_conn() -> AsyncMock:
    """Возвращает mock conn, поддерживающий async with conn.transaction()."""
    conn = AsyncMock()
    conn.transaction = MagicMock(return_value=AsyncMock())
    return conn


def _pending_request(request_id: str, conv_id: str = "conv-1") -> dict:
    return {
        "id": request_id,
        "conversation_id": conv_id,
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
    }


def _fake_wait_with_response():
    """async-генератор: немедленно отдаёт один text-блок ответа."""
    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Ответ агента"}],
            "token_usage": {"in": 10, "out": 5},
        })

    return fake_wait


# ── 1. Optimistic lock fail → rollback, message не сохранён ──────────────────


async def test_optimistic_lock_failed_rollbacks_message():
    """Когда finalize возвращает False (конфликт версии), runner:
    - поднимает OptimisticLockFailed внутри транзакции;
    - транзакция откатывается (проверяем через mock);
    - save_assistant_message был вызван, но его эффект отменён роллбэком;
    - глобальный реестр задачи очищен.
    """
    from app.domains.chat.exceptions import OptimisticLockFailed

    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_pending_request("rid-lock"))
    fake_req_repo.update_status = AsyncMock(return_value=2)
    # finalize → False: оптимистичный конфликт
    fake_req_repo.finalize = AsyncMock(return_value=False)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    save_mock = AsyncMock()

    rollback_triggered = []

    # Перехватываем context manager транзакции, чтобы подтвердить rollback.
    orig_transaction_cm = mock_conn.transaction.return_value

    async def _patched_aexit(exc_type, exc_val, exc_tb):
        if exc_type is not None:
            rollback_triggered.append(exc_type)
        return False

    orig_transaction_cm.__aexit__ = AsyncMock(side_effect=_patched_aexit)

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
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            _fake_wait_with_response(),
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-lock", settings=_settings())

    # save_assistant_message вызывался (внутри транзакции), но транзакция
    # откатилась из-за OptimisticLockFailed.
    save_mock.assert_called_once()

    # Транзакция завершилась с исключением OptimisticLockFailed.
    assert len(rollback_triggered) == 1
    assert rollback_triggered[0] is OptimisticLockFailed

    # finalize был вызван с request_id и версией.
    fake_req_repo.finalize.assert_called_once()
    call_args = fake_req_repo.finalize.call_args
    assert call_args.args[0] == "rid-lock"  # request_id


# ── 2. Race: два параллельных _run, один побеждает ────────────────────────────


async def test_race_only_one_runner_saves_message():
    """Два параллельных _run для одной agent_request.

    Симулируем гонку через finalize: первый вызов возвращает True
    (победитель), второй — False (проигравший, rollback).

    После гонки save_assistant_message был вызван ровно один раз в
    успешной транзакции (второй вызов отменён роллбэком).

    Так как оба runner'а используют один conn mock, считаем вызовы
    save_assistant_message и finalize напрямую.
    """
    mock_conn = _make_mock_conn()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-race"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)

    # Первый вызов finalize → True (winner), второй → False (loser).
    fake_req_repo.finalize = AsyncMock(side_effect=[True, False])

    # Счётчик вызовов save_assistant_message в транзакциях, которые
    # завершились успешно (без исключения).
    successful_saves: list[str] = []
    failed_saves: list[str] = []

    # Перехватываем context manager транзакции, чтобы различать
    # успешное завершение от rollback.
    original_transaction_factory = mock_conn.transaction

    def make_transaction_cm():
        cm = AsyncMock()
        cm._entered = False

        async def _aexit(exc_type, exc_val, exc_tb):
            if exc_type is None:
                successful_saves.append("ok")
            else:
                failed_saves.append(exc_type.__name__)
            return False

        cm.__aexit__ = AsyncMock(side_effect=_aexit)
        return cm

    mock_conn.transaction = MagicMock(side_effect=make_transaction_cm)

    save_mock = AsyncMock()

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
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            _fake_wait_with_response(),
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        # Запускаем оба runner'а параллельно для одной agent_request.
        await asyncio.gather(
            agent_bridge_runner._run("rid-race", settings=_settings()),
            agent_bridge_runner._run("rid-race", settings=_settings()),
        )

    # finalize вызывался ровно дважды (по одному на каждый _run).
    assert fake_req_repo.finalize.await_count == 2

    # save_assistant_message — дважды (один в успешной транзакции, один в
    # откатанной), но в БД попало только одно — победитель.
    assert save_mock.await_count == 2

    # Ровно одна транзакция завершилась успешно, одна — с роллбэком.
    assert len(successful_saves) == 1
    assert len(failed_saves) == 1
    assert failed_saves[0] == "OptimisticLockFailed"


# ── 3. Успешный путь: save + finalize в транзакции ───────────────────────────


async def test_successful_finalize_saves_message_and_sets_done():
    """Happy-path атомарного финализа: save_assistant_message и finalize
    выполняются в одной транзакции, статус переходит в 'done'."""
    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-ok"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    save_mock = AsyncMock()

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
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            _fake_wait_with_response(),
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-ok", settings=_settings())

    # save_assistant_message был вызван ровно раз.
    save_mock.assert_called_once()
    kw = save_mock.call_args.kwargs
    assert kw["conversation_id"] == "conv-1"
    assert kw["content"] == [{"type": "text", "content": "Ответ агента"}]

    # finalize был вызван ровно раз с правильными аргументами.
    fake_req_repo.finalize.assert_called_once()
    fin_args = fake_req_repo.finalize.call_args
    assert fin_args.args[0] == "rid-ok"  # request_id
    # expected_version должна быть передана (version после dispatched=2).
    assert fin_args.args[1] is not None

    # conn.transaction() был вызван (атомарная обёртка).
    mock_conn.transaction.assert_called_once()


# ── 4. finalize вызывается ПОСЛЕ save в той же транзакции ────────────────────


async def test_finalize_called_after_save_within_transaction():
    """Порядок операций в транзакции: сначала save_assistant_message,
    затем finalize. Проверяем через запись порядка вызовов."""
    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-order"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    call_order: list[str] = []

    async def recording_save(**kw):
        call_order.append("save")

    async def recording_finalize(req_id, version, **kw):
        call_order.append("finalize")
        return True

    fake_req_repo.finalize = AsyncMock(side_effect=recording_finalize)

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
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            _fake_wait_with_response(),
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            AsyncMock(side_effect=recording_save),
        ),
    ):
        await agent_bridge_runner._run("rid-order", settings=_settings())

    assert call_order == ["save", "finalize"], (
        f"Ожидался порядок [save, finalize], получено: {call_order}"
    )
