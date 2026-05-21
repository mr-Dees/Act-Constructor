"""Тесты атомарного финализа agent_bridge_runner.

Покрывает три сценария (Phase 1 «D»: инкрементальная запись):

1. Оптимистичная блокировка: req_repo.finalize возвращает False (другой
   воркер уже финализировал) → OptimisticLockFailed → транзакция
   откатывается → finalize_assistant_message эффект отменён роллбэком.

2. Race-симуляция: два параллельных _run на одну agent_request, один
   побеждает (req_repo.finalize=True), второй проигрывает
   (req_repo.finalize=False). Ровно одна транзакция завершилась успешно.

3. Успешный путь: finalize_assistant_message + req_repo.finalize в одной
   транзакции, статус 'done'.

4. Порядок: сначала finalize_assistant_message (мерж блоков), затем
   req_repo.finalize.
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
    s.agent_bridge.poll_min_interval_sec = 0.01
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


def _make_msg_repo_mock() -> MagicMock:
    """MessageRepository mock с append_block."""
    repo = MagicMock()
    repo.append_block = AsyncMock(return_value=True)
    return repo


def _msg_service_mocks() -> dict:
    """Стандартный набор AsyncMock'ов для MessageService."""
    return {
        "start_streaming_assistant_message": AsyncMock(return_value={
            "id": "msg-1",
            "status": "streaming",
            "content": [],
        }),
        "finalize_assistant_message": AsyncMock(return_value=True),
        "fail_assistant_message": AsyncMock(return_value=True),
    }


def _patch_runner(
    *,
    mock_conn,
    fake_req_repo,
    fake_msg_repo,
    msg_mocks: dict,
    wait_fn,
):
    """Возвращает список patch() context managers для _run."""
    fake_adapter = MagicMock(get_table_name=lambda n: n)
    patches = [
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
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            wait_fn,
        ),
    ]
    for name, mock in msg_mocks.items():
        patches.append(
            patch(
                f"app.domains.chat.services.message_service."
                f"MessageService.{name}",
                mock,
            ),
        )
    return patches


# ── 1. Optimistic lock fail → rollback ──────────────────────────────────────


async def test_optimistic_lock_failed_rollbacks_message():
    """Когда req_repo.finalize возвращает False (конфликт версии), runner:
    - поднимает OptimisticLockFailed внутри транзакции;
    - транзакция откатывается (проверяем через mock);
    - finalize_assistant_message вызывался, но эффект отменён роллбэком.
    """
    from app.domains.chat.exceptions import OptimisticLockFailed

    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_pending_request("rid-lock"))
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=False)
    fake_msg_repo = _make_msg_repo_mock()

    rollback_triggered = []
    orig_transaction_cm = mock_conn.transaction.return_value

    async def _patched_aexit(exc_type, exc_val, exc_tb):
        if exc_type is not None:
            rollback_triggered.append(exc_type)
        return False

    orig_transaction_cm.__aexit__ = AsyncMock(side_effect=_patched_aexit)

    msg_mocks = _msg_service_mocks()

    patches = _patch_runner(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_mocks=msg_mocks,
        wait_fn=_fake_wait_with_response(),
    )
    for p in patches:
        p.start()
    try:
        await agent_bridge_runner._run("rid-lock", settings=_settings())
    finally:
        for p in reversed(patches):
            p.stop()

    # finalize_assistant_message вызывался (внутри транзакции),
    # но транзакция откатилась из-за OptimisticLockFailed.
    msg_mocks["finalize_assistant_message"].assert_awaited_once()

    # Транзакция завершилась с исключением OptimisticLockFailed.
    assert len(rollback_triggered) == 1
    assert rollback_triggered[0] is OptimisticLockFailed

    fake_req_repo.finalize.assert_awaited_once()
    call_args = fake_req_repo.finalize.call_args
    assert call_args.args[0] == "rid-lock"


# ── 2. Race: два параллельных _run ──────────────────────────────────────────


async def test_race_only_one_runner_finalizes_message():
    """Два параллельных _run для одной agent_request.

    Симулируем гонку через req_repo.finalize: первый вызов возвращает
    True (победитель), второй — False (проигравший, rollback).
    После гонки finalize_assistant_message вызывался дважды (один в
    успешной транзакции, один в откатанной).
    """
    mock_conn = _make_mock_conn()

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-race"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(side_effect=[True, False])
    fake_msg_repo = _make_msg_repo_mock()

    successful_saves: list[str] = []
    failed_saves: list[str] = []

    def make_transaction_cm():
        cm = AsyncMock()

        async def _aexit(exc_type, exc_val, exc_tb):
            if exc_type is None:
                successful_saves.append("ok")
            else:
                failed_saves.append(exc_type.__name__)
            return False

        cm.__aexit__ = AsyncMock(side_effect=_aexit)
        return cm

    mock_conn.transaction = MagicMock(side_effect=make_transaction_cm)

    msg_mocks = _msg_service_mocks()

    patches = _patch_runner(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_mocks=msg_mocks,
        wait_fn=_fake_wait_with_response(),
    )
    for p in patches:
        p.start()
    try:
        await asyncio.gather(
            agent_bridge_runner._run("rid-race", settings=_settings()),
            agent_bridge_runner._run("rid-race", settings=_settings()),
        )
    finally:
        for p in reversed(patches):
            p.stop()

    assert fake_req_repo.finalize.await_count == 2
    assert msg_mocks["finalize_assistant_message"].await_count == 2

    # Ровно одна транзакция завершилась успешно, одна — с роллбэком.
    assert len(successful_saves) == 1
    assert len(failed_saves) == 1
    assert failed_saves[0] == "OptimisticLockFailed"


# ── 3. Успешный путь ──────────────────────────────────────────────────────


async def test_successful_finalize_saves_message_and_sets_done():
    """Happy-path: finalize_assistant_message + req_repo.finalize в одной
    транзакции, статус переходит в 'done'."""
    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-ok"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    msg_mocks = _msg_service_mocks()

    patches = _patch_runner(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_mocks=msg_mocks,
        wait_fn=_fake_wait_with_response(),
    )
    for p in patches:
        p.start()
    try:
        await agent_bridge_runner._run("rid-ok", settings=_settings())
    finally:
        for p in reversed(patches):
            p.stop()

    fin_mock = msg_mocks["finalize_assistant_message"]
    fin_mock.assert_awaited_once()
    kw = fin_mock.call_args.kwargs
    assert kw["conversation_id"] == "conv-1"
    assert kw["final_blocks"] == [
        {"type": "text", "content": "Ответ агента"},
    ]

    fake_req_repo.finalize.assert_awaited_once()
    fin_args = fake_req_repo.finalize.call_args
    assert fin_args.args[0] == "rid-ok"
    assert fin_args.args[1] is not None

    # conn.transaction() — единственный явный transaction-обёртка в
    # финальной фазе. (Phase 1b start_streaming не открывает
    # transaction() напрямую — finalize_assistant_message открывает её
    # сам внутри MessageService, через ту же conn — что в проде является
    # savepoint.)
    assert mock_conn.transaction.call_count == 1


# ── 4. Порядок: finalize_assistant_message → req_repo.finalize ─────────────


async def test_finalize_called_after_message_finalize_within_transaction():
    """Порядок операций в транзакции: сначала finalize_assistant_message
    (merge блоков), затем req_repo.finalize.
    """
    mock_conn = _make_mock_conn()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        return_value=_pending_request("rid-order"),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_msg_repo = _make_msg_repo_mock()

    call_order: list[str] = []

    async def recording_finalize_msg(*a, **kw):
        call_order.append("finalize_message")
        return True

    async def recording_finalize_req(req_id, version, **kw):
        call_order.append("finalize_req")
        return True

    fake_req_repo.finalize = AsyncMock(side_effect=recording_finalize_req)

    msg_mocks = _msg_service_mocks()
    msg_mocks["finalize_assistant_message"] = AsyncMock(
        side_effect=recording_finalize_msg,
    )

    patches = _patch_runner(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_mocks=msg_mocks,
        wait_fn=_fake_wait_with_response(),
    )
    for p in patches:
        p.start()
    try:
        await agent_bridge_runner._run("rid-order", settings=_settings())
    finally:
        for p in reversed(patches):
            p.stop()

    assert call_order == ["finalize_message", "finalize_req"], (
        f"Ожидался порядок [finalize_message, finalize_req], "
        f"получено: {call_order}"
    )
