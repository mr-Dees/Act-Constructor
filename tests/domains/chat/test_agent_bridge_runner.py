"""Тесты фонового раннера polling-задач к внешнему ИИ-агенту."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.chat.services import agent_bridge_runner
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _reset_registry():
    """Очищает глобальный реестр раннера между тестами."""
    agent_bridge_runner._running.clear()
    yield
    # Если в тесте остались живые задачи — отменяем их, чтобы не
    # «протекали» между прогонами.
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
    """Возвращает фабрику get_db(), возвращающую переданный mock-conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


def _make_coord_with_events(events: list[dict]):
    """Возвращает (coordinator, queue) с предзаряженными событиями."""
    from app.domains.chat.services.poll_coordinator import PollCoordinator

    queue: asyncio.Queue = asyncio.Queue()
    for ev in events:
        queue.put_nowait(ev)
    coordinator = MagicMock(spec=PollCoordinator)
    coordinator.subscribe = AsyncMock(return_value=queue)
    coordinator.unsubscribe = AsyncMock()
    return coordinator, queue


def _request_row(rid: str = "rid-X", message_id: str = "msg-1"):
    return {
        "id": rid,
        "conversation_id": "conv-1",
        "message_id": message_id,
        "user_id": "u",
        "status": "pending",
        "version": 1,
    }


def _patch_runner_deps(
    *,
    mock_conn,
    fake_req_repo,
    fake_msg_repo,
    msg_service_mocks: dict,
    poll_response_fn=None,
    wait_for_completion_fn=None,
):
    """Возвращает ExitStack с patch'ами для нового контракта _run.

    msg_service_mocks — dict с обязательными AsyncMock'ами:
        start_streaming_assistant_message,
        finalize_assistant_message,
        fail_assistant_message.
    """
    fake_adapter = MagicMock(get_table_name=lambda n: n)
    stack = ExitStack()
    stack.enter_context(
        patch("app.db.connection.get_db", _fake_get_db_ctx(mock_conn)),
    )
    stack.enter_context(
        patch(
            "app.db.repositories.base.get_adapter",
            return_value=fake_adapter,
        ),
    )
    stack.enter_context(
        patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository",
            return_value=fake_req_repo,
        ),
    )
    stack.enter_context(
        patch(
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
    )
    if poll_response_fn is not None:
        stack.enter_context(
            patch(
                "app.domains.chat.services.agent_bridge."
                "AgentBridgeService.poll_response",
                poll_response_fn,
            ),
        )
    if wait_for_completion_fn is not None:
        stack.enter_context(
            patch(
                "app.domains.chat.services.agent_bridge."
                "AgentBridgeService.wait_for_completion",
                wait_for_completion_fn,
            ),
        )
    # Патчим методы MessageService на лету, чтобы перехватывать вызовы.
    for name, mock in msg_service_mocks.items():
        stack.enter_context(
            patch(
                f"app.domains.chat.services.message_service."
                f"MessageService.{name}",
                mock,
            ),
        )
    return stack


def _make_msg_service_mocks() -> dict:
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


def _make_msg_repo_mock() -> MagicMock:
    """MessageRepository mock с append_block (короткие транзакции в Phase 2)."""
    repo = MagicMock()
    repo.append_block = AsyncMock(return_value=True)
    return repo


# ── schedule / is_running ──


async def test_schedule_is_idempotent():
    """Повторный вызов schedule для того же request_id не создаёт новой
    задачи: возвращает уже идущую."""
    started = asyncio.Event()

    async def fake_run(_rid, *, settings, coordinator=None):  # noqa: ARG001
        started.set()
        await asyncio.sleep(10)

    with patch.object(agent_bridge_runner, "_run", fake_run):
        t1 = agent_bridge_runner.schedule("rid-1", settings=_settings())
        await asyncio.wait_for(started.wait(), timeout=1.0)
        t2 = agent_bridge_runner.schedule("rid-1", settings=_settings())
    assert t1 is t2
    assert agent_bridge_runner.is_running("rid-1")
    t1.cancel()


async def test_is_running_false_for_unknown_id():
    assert not agent_bridge_runner.is_running("nope")


# ── _run: инкрементальная запись (Phase 1 «D») ──


async def test_run_starts_streaming_message_before_first_event():
    """Phase 1b: start_streaming_assistant_message вызывается ДО polling'а.

    Иначе при мгновенном финале (агент ответил пока runner стартовал) у
    нас не было бы записи, к которой делать append_block.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-1"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    call_order: list[str] = []

    async def fake_wait(self, *a, **kw):
        call_order.append("polling_started")
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Готово"}],
            "token_usage": {},
        })

    msg_mocks = _make_msg_service_mocks()
    original_start = msg_mocks["start_streaming_assistant_message"]

    async def track_start(self, **kw):  # noqa: ARG001
        call_order.append("start_streaming")
        return await original_start(self, **kw) if False else {
            "id": kw["message_id"],
            "status": "streaming",
            "content": [],
        }

    msg_mocks["start_streaming_assistant_message"] = AsyncMock(
        side_effect=lambda **kw: (
            call_order.append("start_streaming")
            or {"id": kw["message_id"], "status": "streaming", "content": []}
        ),
    )

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    assert "start_streaming" in call_order
    assert "polling_started" in call_order
    assert call_order.index("start_streaming") < call_order.index(
        "polling_started",
    )
    # message_id из request_row пробрасывается в start_streaming.
    start_call = msg_mocks["start_streaming_assistant_message"].call_args
    assert start_call.kwargs["message_id"] == "msg-1"
    assert start_call.kwargs["conversation_id"] == "conv-1"


async def test_run_appends_reasoning_block_per_event():
    """Phase 2: каждый reasoning-event вызывает append_block с
    детерминированным block_id `{message_id}:reasoning:{seq}`."""
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-app"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(event={
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Думаю..."},
        })
        yield AgentBridgeUpdate(event={
            "id": 2, "seq": 2, "event_type": "reasoning",
            "payload": {"text": "Ещё думаю..."},
        })
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Ответ"}],
            "token_usage": {"in": 10, "out": 5},
        })

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-app", settings=_settings())

    # append_block вызывался на каждый reasoning-event.
    assert fake_msg_repo.append_block.await_count == 2
    calls = fake_msg_repo.append_block.await_args_list
    block1 = calls[0].kwargs["block"]
    assert block1["type"] == "reasoning"
    assert block1["content"] == "Думаю..."
    assert block1["block_id"] == "msg-1:reasoning:1"
    block2 = calls[1].kwargs["block"]
    assert block2["block_id"] == "msg-1:reasoning:2"


async def test_run_finalizes_message_with_final_blocks():
    """Phase 3: на финале вызывается finalize_assistant_message с
    блоками из upd.response. Reasoning'и НЕ дублируются в final_blocks —
    они уже накоплены через append_block, дедуп выполняет
    MessageRepository.finalize по block_id.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-fin"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(event={
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Думаю..."},
        })
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Ответ"}],
            "token_usage": {"in": 10, "out": 5},
        })

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-fin", settings=_settings())

    fin_mock = msg_mocks["finalize_assistant_message"]
    fin_mock.assert_awaited_once()
    kw = fin_mock.call_args.kwargs
    assert kw["message_id"] == "msg-1"
    assert kw["conversation_id"] == "conv-1"
    # Только финальные блоки агента — reasoning уже в БД.
    assert kw["final_blocks"] == [{"type": "text", "content": "Ответ"}]
    assert kw["token_usage"] == {"in": 10, "out": 5}
    # req_repo.finalize должен быть вызван в той же транзакции.
    fake_req_repo.finalize.assert_awaited_once()


async def test_run_calls_fail_on_bridge_timeout():
    """На AgentBridgeTimeout runner зовёт fail_assistant_message с
    error-блоком. save_assistant_message и finalize не вызываются.
    """
    from app.domains.chat.services.agent_bridge import AgentBridgeTimeout

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-to"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    async def fake_wait(self, *a, **kw):
        raise AgentBridgeTimeout("test timeout")
        yield  # pragma: no cover

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-to", settings=_settings())

    fail_mock = msg_mocks["fail_assistant_message"]
    fail_mock.assert_awaited_once()
    kw = fail_mock.call_args.kwargs
    assert kw["message_id"] == "msg-1"
    assert kw["conversation_id"] == "conv-1"
    error_block = kw["error_block"]
    assert error_block["type"] == "error"
    assert error_block["code"] == "agent_timeout"
    assert error_block["block_id"] == "msg-1:error:1"
    # finalize не должен вызываться при таймауте.
    msg_mocks["finalize_assistant_message"].assert_not_awaited()
    fake_req_repo.finalize.assert_not_awaited()


async def test_run_skips_when_request_already_done():
    """Если статус request'а — done/error/timeout, раннер ничего не делает.

    Особенно НЕ вызывает start_streaming (иначе перезаписали бы уже
    закрытое сообщение).
    """
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1", "conversation_id": "c", "status": "done",
    })
    fake_req_repo.update_status = AsyncMock()
    fake_req_repo.finalize = AsyncMock()
    fake_msg_repo = _make_msg_repo_mock()
    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    fake_req_repo.update_status.assert_not_called()
    msg_mocks["start_streaming_assistant_message"].assert_not_awaited()
    msg_mocks["finalize_assistant_message"].assert_not_awaited()
    msg_mocks["fail_assistant_message"].assert_not_awaited()


async def test_run_continues_after_crash_recovery_in_start_streaming():
    """Crash-recovery: если запись уже была (UniqueViolation внутри
    create_streaming, который вернул existing row) — runner всё равно
    продолжает работу: подхватывает события и финализирует.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-recover"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Финал"}],
            "token_usage": {},
        })

    msg_mocks = _make_msg_service_mocks()
    # start_streaming возвращает уже существующую запись с накопленным
    # reasoning'ом (симуляция recovery после рестарта).
    msg_mocks["start_streaming_assistant_message"] = AsyncMock(
        return_value={
            "id": "msg-1",
            "status": "streaming",
            "content": [
                {
                    "type": "reasoning",
                    "content": "из прошлой жизни",
                    "block_id": "msg-1:reasoning:1",
                },
            ],
        },
    )

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-recover", settings=_settings())

    # finalize всё равно вызывается с финальными блоками.
    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    fake_req_repo.finalize.assert_awaited_once()


async def test_run_idempotent_duplicate_event_no_runner_crash():
    """Идемпотентность: повторное приходящее событие с тем же seq
    не приводит к падению runner'а (append_block дедупит по block_id).
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-dup"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()
    # Симуляция дедупа на уровне репо: append_block возвращает True
    # даже если block_id уже был.
    fake_msg_repo.append_block = AsyncMock(return_value=True)

    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        # Один и тот же seq=1 эмитится дважды (например, после рестарта
        # PollCoordinator перечитал агентные events с начала).
        yield AgentBridgeUpdate(event={
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Один"},
        })
        yield AgentBridgeUpdate(event={
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Один"},
        })
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "Готово"}],
            "token_usage": {},
        })

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        wait_for_completion_fn=fake_wait,
    ):
        await agent_bridge_runner._run("rid-dup", settings=_settings())

    # append_block вызван дважды — но репо дедупит, никто не упал.
    assert fake_msg_repo.append_block.await_count == 2
    # Оба вызова с одинаковым block_id.
    ids = [
        c.kwargs["block"]["block_id"]
        for c in fake_msg_repo.append_block.await_args_list
    ]
    assert ids == ["msg-1:reasoning:1", "msg-1:reasoning:1"]
    # finalize всё равно отрабатывает успешно.
    msg_mocks["finalize_assistant_message"].assert_awaited_once()


async def test_runner_finalizes_message_when_response_arrives_via_coordinator(
    caplog,
):
    """Регрессия Bug 1: после получения response через coordinator runner
    должен успешно финализировать ассистент-message (не падать на
    OptimisticLockFailed).
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-coord"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Думаю..."},
        },
    ])
    final_response = {
        "blocks": [{"type": "text", "content": "Ответ"}],
        "token_usage": {"in": 10, "out": 5},
    }

    async def fake_poll(self, _rid):  # noqa: ARG001
        return final_response

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        import logging
        caplog.set_level(
            logging.WARNING,
            logger="audit_workstation.domains.chat.agent_bridge_runner",
        )
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-coord",
                settings=_settings(),
                coordinator=coordinator,
            ),
            timeout=2.0,
        )

    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    fin_kw = msg_mocks["finalize_assistant_message"].call_args.kwargs
    assert fin_kw["final_blocks"] == [{"type": "text", "content": "Ответ"}]
    assert fin_kw["token_usage"] == {"in": 10, "out": 5}

    # update_status НЕ вызывался со status='done' (фикс Bug 1).
    done_calls = [
        c for c in fake_req_repo.update_status.call_args_list
        if c.kwargs.get("status") == "done"
    ]
    assert done_calls == []
    assert "optimistic lock conflict" not in caplog.text.lower()


async def test_status_stays_in_progress_until_finalize():
    """Инвариант: до вызова req.finalize() статус в БД остаётся
    'in_progress' (или 'dispatched'). 'done' появляется ТОЛЬКО внутри
    finalize() в одной транзакции с finalize_assistant_message.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-inv"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "event_type": "reasoning",
            "payload": {"text": "T"},
        },
    ])
    final_response = {
        "blocks": [{"type": "text", "content": "Ok"}],
        "token_usage": {},
    }

    async def fake_poll(self, _rid):  # noqa: ARG001
        return final_response

    msg_mocks = _make_msg_service_mocks()

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        await agent_bridge_runner._run(
            "rid-inv",
            settings=_settings(),
            coordinator=coordinator,
        )

    statuses = [
        c.kwargs.get("status")
        for c in fake_req_repo.update_status.call_args_list
    ]
    assert statuses == ["dispatched", "in_progress"]
    assert "done" not in statuses
    fake_req_repo.finalize.assert_awaited_once()


# ── _wait_via_coordinator: A+D — push 'final' event + fallback poll ──


async def test_final_event_triggers_immediate_finalize():
    """Фикс D (primary push): 'final' event в очереди → runner сразу
    делает poll_response и финализирует, не дожидаясь event_timeout.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-final"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Думаю..."},
        },
        {
            "id": 2, "seq": 2, "event_type": "final",
            "payload": {},
        },
    ])

    final_response = {
        "blocks": [{"type": "text", "content": "Ответ"}],
        "token_usage": {"in": 10, "out": 5},
    }
    poll_calls: list[str] = []

    async def fake_poll(self, rid):  # noqa: ARG001
        poll_calls.append(rid)
        return final_response

    msg_mocks = _make_msg_service_mocks()
    settings = _settings()
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-final",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=2.0,
        )

    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    final_blocks = (
        msg_mocks["finalize_assistant_message"]
        .call_args.kwargs["final_blocks"]
    )
    # 'final'-event сам не блок — только text от response.
    assert final_blocks == [{"type": "text", "content": "Ответ"}]
    # append_block вызывался только на reasoning (final не блок).
    assert fake_msg_repo.append_block.await_count == 1
    block = fake_msg_repo.append_block.await_args_list[0].kwargs["block"]
    assert block["type"] == "reasoning"
    assert len(poll_calls) >= 1


async def test_fallback_poll_picks_response_without_final_event():
    """Фикс A (fallback poll): без 'final'-события runner всё равно
    подхватывает response через периодический poll_response.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-fb"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Размышляю"},
        },
    ])

    final_response = {
        "blocks": [{"type": "text", "content": "Готово"}],
        "token_usage": {},
    }
    poll_calls = [0]

    async def fake_poll(self, _rid):  # noqa: ARG001
        poll_calls[0] += 1
        if poll_calls[0] < 3:
            return None
        return final_response

    msg_mocks = _make_msg_service_mocks()
    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.01
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-fb",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=2.0,
        )

    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    fin_kw = msg_mocks["finalize_assistant_message"].call_args.kwargs
    assert fin_kw["final_blocks"] == [{"type": "text", "content": "Готово"}]
    # append_block только на reasoning (final не пришёл).
    assert fake_msg_repo.append_block.await_count == 1
    assert poll_calls[0] >= 3


async def test_final_event_with_unwritten_response_continues_polling():
    """Race: 'final' пришёл, но agent_responses ещё не виден → runner
    делает continue и подхватывает response через fallback poll.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-race"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "seq": 1, "event_type": "final",
            "payload": {},
        },
    ])

    final_response = {
        "blocks": [{"type": "text", "content": "Ответ после race"}],
        "token_usage": {},
    }
    call_counter = [0]

    async def fake_poll(self, _rid):  # noqa: ARG001
        call_counter[0] += 1
        if call_counter[0] == 1:
            return None
        return final_response

    msg_mocks = _make_msg_service_mocks()
    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.01
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-race",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=2.0,
        )

    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    fin_kw = msg_mocks["finalize_assistant_message"].call_args.kwargs
    assert fin_kw["final_blocks"] == [
        {"type": "text", "content": "Ответ после race"},
    ]
    assert call_counter[0] >= 2


async def test_no_finalize_delay_after_last_event():
    """Регрессия: между последним reasoning и finalize проходит ≪
    event_timeout (фикс A в _wait_via_coordinator).
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-delay"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = _make_msg_repo_mock()

    coordinator, _ = _make_coord_with_events([
        {
            "id": 1, "seq": 1, "event_type": "reasoning",
            "payload": {"text": "Один"},
        },
    ])

    response_available_at: list[float] = []
    response_picked_up_at: list[float] = []
    final_response = {
        "blocks": [{"type": "text", "content": "End"}],
        "token_usage": {},
    }

    async def fake_poll(self, _rid):  # noqa: ARG001
        now = asyncio.get_event_loop().time()
        if not response_available_at:
            response_available_at.append(now)
            return None
        response_picked_up_at.append(now)
        return final_response

    msg_mocks = _make_msg_service_mocks()
    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.02
    settings.agent_bridge.event_timeout_sec = 10

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        fake_msg_repo=fake_msg_repo,
        msg_service_mocks=msg_mocks,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-delay",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=1.0,
        )

    msg_mocks["finalize_assistant_message"].assert_awaited_once()
    assert response_available_at and response_picked_up_at
    reaction_delay = response_picked_up_at[0] - response_available_at[0]
    assert reaction_delay < 1.0, (
        f"finalize отложился на {reaction_delay:.3f}s — больше разумного"
    )


# ── schedule_pending: lifespan-reconcile ──


async def test_schedule_pending_runs_task_per_claimed_id():
    """schedule_pending атомарно клеймит свободные pending/dispatched-
    запросы через claim_pending и запускает schedule() для каждого."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.claim_pending = AsyncMock(return_value=["rid-1", "rid-2"])
    fake_req_repo.get = AsyncMock(return_value={"user_id": "u1"})
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    started = []

    def fake_schedule(rid, *, settings, coordinator=None):  # noqa: ARG001
        started.append(rid)
        return MagicMock()

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
        patch.object(agent_bridge_runner, "schedule", fake_schedule),
    ):
        count = await agent_bridge_runner.schedule_pending(
            settings=_settings(), older_than_sec=30,
        )

    assert count == 2
    assert started == ["rid-1", "rid-2"]
    fake_req_repo.claim_pending.assert_awaited_once()
    kwargs = fake_req_repo.claim_pending.call_args.kwargs
    assert kwargs["older_than_sec"] == 30
    assert isinstance(kwargs["worker_token"], str)
    assert len(kwargs["worker_token"]) == 36


async def test_schedule_pending_skips_already_running():
    """Если для заклеймленного id уже идёт задача — повторный schedule
    не выполняется (in-process защита поверх БД-claim)."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.claim_pending = AsyncMock(return_value=["rid-1", "rid-2"])
    fake_req_repo.get = AsyncMock(return_value={"user_id": "u1"})
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def _noop():
        await asyncio.sleep(10)
    live_task = asyncio.create_task(_noop())
    agent_bridge_runner._running["rid-1"] = live_task

    called_with: list[str] = []

    def fake_schedule(rid, *, settings, coordinator=None):  # noqa: ARG001
        called_with.append(rid)
        return MagicMock()

    try:
        with (
            patch(
                "app.db.connection.get_db", _fake_get_db_ctx(mock_conn),
            ),
            patch(
                "app.db.repositories.base.get_adapter",
                return_value=fake_adapter,
            ),
            patch(
                "app.domains.chat.repositories."
                "agent_request_repository.AgentRequestRepository",
                return_value=fake_req_repo,
            ),
            patch.object(agent_bridge_runner, "schedule", fake_schedule),
        ):
            count = await agent_bridge_runner.schedule_pending(
                settings=_settings(),
            )
    finally:
        live_task.cancel()

    assert count == 1
    assert called_with == ["rid-2"]


# ── shutdown_running ──


async def test_shutdown_running_empty_registry_returns_zero():
    """Без активных задач — корректно возвращает 0, не падает."""
    assert agent_bridge_runner._running == {}
    cancelled = await agent_bridge_runner.shutdown_running(timeout_sec=1.0)
    assert cancelled == 0


async def test_shutdown_running_cancels_and_waits():
    """Отменяет живые задачи и ждёт их завершения."""
    cancelled_flags: dict[str, bool] = {}

    async def long_run(rid, *, settings, coordinator=None):  # noqa: ARG001
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled_flags[rid] = True
            raise

    with patch.object(agent_bridge_runner, "_run", long_run):
        agent_bridge_runner.schedule("rid-a", settings=_settings())
        agent_bridge_runner.schedule("rid-b", settings=_settings())
        await asyncio.sleep(0.01)

        count = await agent_bridge_runner.shutdown_running(timeout_sec=1.0)

    assert count == 2
    assert cancelled_flags == {"rid-a": True, "rid-b": True}
    assert agent_bridge_runner._running == {}
