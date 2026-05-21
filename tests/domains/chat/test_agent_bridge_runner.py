"""Тесты фонового раннера polling-задач к внешнему ИИ-агенту."""
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


# ── schedule / is_running ──


async def test_schedule_is_idempotent():
    """Повторный вызов schedule для того же request_id не создаёт новой
    задачи: возвращает уже идущую."""
    # Подсовываем _run, который висит до отмены — задача будет считаться
    # «живой» и при втором вызове schedule её должны вернуть.
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


# ── _run: сохранение сообщения ──


async def test_run_saves_assistant_message_with_collected_blocks():
    """Раннер аккумулирует reasoning + финальный response и зовёт
    MessageService.save_assistant_message с собранным content."""
    # mock_conn в этом тесте мы не вытаскиваем из фикстуры (run сам зовёт
    # get_db()), а готовим вручную, чтобы запатчить.
    mock_conn = AsyncMock()
    # conn.transaction() должен поддерживать async with.
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    # AgentRequestRepository.get → возвращает запрос со status='pending'.
    request_row = {
        "id": "rid-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
    }
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=request_row)
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)

    # bridge.wait_for_completion → yield reasoning event + final response.
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

    # MessageService.save_assistant_message → ловим.
    save_mock = AsyncMock()

    fake_adapter = MagicMock(get_table_name=lambda n: n)

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx(mock_conn),
        ),
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
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    # Раннер прошёл фазами pending → dispatched → in_progress.
    # 'dispatched' ставится сразу при подхвате запроса (наблюдаемость:
    # «AW взяла в работу, ждём агента»), 'in_progress' — при первом
    # событии от агента (наблюдаемость: «агент пишет»).
    # update_status вызывается с expected_version для optimistic locking.
    statuses_in_order = [
        c.kwargs.get("status")
        for c in fake_req_repo.update_status.call_args_list
        if c.kwargs.get("status") in ("dispatched", "in_progress")
    ]
    assert statuses_in_order == ["dispatched", "in_progress"]
    # В обоих вызовах передан expected_version (optimistic locking).
    for c in fake_req_repo.update_status.call_args_list:
        if c.kwargs.get("status") in ("dispatched", "in_progress"):
            assert "expected_version" in c.kwargs

    # save_assistant_message получил собранный content.
    # Reasoning-блоки идут с детерминированным block_id
    # `{message_id}:reasoning:{seq}` — фронт дедупит по нему при Resume.
    save_mock.assert_called_once()
    kw = save_mock.call_args.kwargs
    assert kw["conversation_id"] == "conv-1"
    assert kw["content"] == [
        {
            "type": "reasoning",
            "content": "Думаю...",
            "block_id": "msg-1:reasoning:1",
        },
        {"type": "text", "content": "Ответ"},
    ]
    assert kw["token_usage"] == {"in": 10, "out": 5}


async def test_run_skips_when_request_already_done():
    """Если статус request'а — done/error/timeout, раннер ничего не делает."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1", "conversation_id": "c", "status": "done",
    })
    fake_req_repo.update_status = AsyncMock()
    save_mock = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

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
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    # Никаких изменений и сохранения сообщения.
    fake_req_repo.update_status.assert_not_called()
    save_mock.assert_not_called()


async def test_runner_saves_message_when_response_arrives_via_coordinator(
    caplog,
):
    """Регрессия Bug 1: после получения response через coordinator
    runner должен успешно сохранить ассистент-message (не падать на
    OptimisticLockFailed).

    Сценарий: coordinator yield'ит сначала event (reasoning), потом
    response. Раннер обязан собрать blocks и сохранить сообщение в
    одной транзакции с finalize(), без version-конфликта.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    request_row = {
        "id": "rid-coord",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
    }
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=request_row)
    # update_status: pending->dispatched -> v2; dispatched->in_progress
    # -> v3. Никаких дальнейших update_status('done') здесь быть не
    # должно — это и есть фикс Bug 1.
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

    # Мокаем PollCoordinator: subscribe возвращает Queue, в которую мы
    # положим reasoning-событие. Финальный response отдаёт bridge.poll_response.
    from app.domains.chat.services.poll_coordinator import PollCoordinator

    queue: asyncio.Queue = asyncio.Queue()
    await queue.put({
        "id": 1, "seq": 1, "event_type": "reasoning",
        "payload": {"text": "Думаю..."},
    })
    fake_coordinator = MagicMock(spec=PollCoordinator)
    fake_coordinator.subscribe = AsyncMock(return_value=queue)
    fake_coordinator.unsubscribe = AsyncMock()

    # bridge.poll_response: после получения reasoning-события раннер
    # сразу зовёт poll_response — отдаём финальный response.
    final_response = {
        "blocks": [{"type": "text", "content": "Ответ"}],
        "token_usage": {"in": 10, "out": 5},
    }

    async def fake_poll(self, _rid):  # noqa: ARG001
        return final_response

    save_mock = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx(mock_conn),
        ),
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
            "AgentBridgeService.poll_response",
            fake_poll,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        import logging
        caplog.set_level(
            logging.WARNING,
            logger="audit_workstation.domains.chat.agent_bridge_runner",
        )
        await agent_bridge_runner._run(
            "rid-coord",
            settings=_settings(),
            coordinator=fake_coordinator,
        )

    # save_assistant_message вызван один раз с правильными blocks.
    save_mock.assert_called_once()
    kw = save_mock.call_args.kwargs
    assert kw["conversation_id"] == "conv-1"
    assert kw["content"] == [
        {
            "type": "reasoning",
            "content": "Думаю...",
            "block_id": "msg-1:reasoning:1",
        },
        {"type": "text", "content": "Ответ"},
    ]
    assert kw["token_usage"] == {"in": 10, "out": 5}

    # finalize вызван и вернул True (нет version-конфликта).
    fake_req_repo.finalize.assert_awaited_once()
    finalize_call = fake_req_repo.finalize.call_args
    # Позиционные args: (request_id, expected_version)
    assert finalize_call.args[0] == "rid-coord"

    # update_status НЕ вызывался со status='done' (это и есть фикс).
    done_calls = [
        c for c in fake_req_repo.update_status.call_args_list
        if c.kwargs.get("status") == "done"
    ]
    assert done_calls == []

    # В логах нет 'optimistic lock conflict'.
    assert "optimistic lock conflict" not in caplog.text.lower()


async def test_status_stays_in_progress_until_finalize():
    """Инвариант: до вызова finalize() статус в БД остаётся 'in_progress'.

    Между моментом, когда координатор отдал финальный response, и
    моментом коммита транзакции finalize+save_assistant_message — статус
    не успевает стать 'done' через update_status. 'done' появляется
    ТОЛЬКО внутри finalize().
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    request_row = {
        "id": "rid-inv",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
    }
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=request_row)
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

    from app.domains.chat.services.poll_coordinator import PollCoordinator

    queue: asyncio.Queue = asyncio.Queue()
    await queue.put({
        "id": 1, "event_type": "reasoning",
        "payload": {"text": "T"},
    })
    fake_coordinator = MagicMock(spec=PollCoordinator)
    fake_coordinator.subscribe = AsyncMock(return_value=queue)
    fake_coordinator.unsubscribe = AsyncMock()

    final_response = {
        "blocks": [{"type": "text", "content": "Ok"}], "token_usage": {},
    }

    async def fake_poll(self, _rid):  # noqa: ARG001
        return final_response

    save_mock = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

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
            "AgentBridgeService.poll_response",
            fake_poll,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run(
            "rid-inv",
            settings=_settings(),
            coordinator=fake_coordinator,
        )

    # Все статусы, прошедшие через update_status: только
    # dispatched и in_progress. 'done' — ни разу.
    statuses = [
        c.kwargs.get("status")
        for c in fake_req_repo.update_status.call_args_list
    ]
    assert statuses == ["dispatched", "in_progress"]
    assert "done" not in statuses
    # finalize() — единственная точка перевода в done.
    fake_req_repo.finalize.assert_awaited_once()


async def test_run_saves_timeout_error_block_on_bridge_timeout():
    """Если bridge выбрасывает AgentBridgeTimeout, раннер всё равно
    сохраняет сообщение с блоком-ошибкой (чтобы пользователь увидел контекст)."""
    from app.domains.chat.services.agent_bridge import AgentBridgeTimeout

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1", "conversation_id": "conv-1", "status": "pending",
        "version": 1,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    save_mock = AsyncMock()

    async def fake_wait(self, *a, **kw):
        raise AgentBridgeTimeout("test timeout")
        yield  # pragma: no cover  (нужно, чтобы func был async-gen'ом)

    fake_adapter = MagicMock(get_table_name=lambda n: n)

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
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    save_mock.assert_called_once()
    content = save_mock.call_args.kwargs["content"]
    assert len(content) == 1
    assert content[0]["type"] == "error"
    assert content[0]["code"] == "agent_timeout"


# ── schedule_pending: lifespan-reconcile ──


async def test_schedule_pending_runs_task_per_claimed_id():
    """schedule_pending атомарно клеймит свободные pending/dispatched-
    запросы через claim_pending и запускает schedule() для каждого
    заклеймленного id."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.claim_pending = AsyncMock(return_value=["rid-1", "rid-2"])
    fake_req_repo.get = AsyncMock(return_value={"user_id": "u1"})
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    started = []

    def fake_schedule(rid, *, settings, coordinator=None):  # noqa: ARG001
        started.append(rid)
        # Возвращаем заглушку Task-подобного объекта.
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
    # claim_pending был вызван с уникальным worker_token и порогом.
    fake_req_repo.claim_pending.assert_awaited_once()
    kwargs = fake_req_repo.claim_pending.call_args.kwargs
    assert kwargs["older_than_sec"] == 30
    assert isinstance(kwargs["worker_token"], str)
    assert len(kwargs["worker_token"]) == 36  # UUID4


async def test_schedule_pending_skips_already_running():
    """Если для заклеймленного id уже идёт задача в этом процессе,
    повторный schedule не выполняется (in-process защита поверх БД-claim)."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.claim_pending = AsyncMock(return_value=["rid-1", "rid-2"])
    fake_req_repo.get = AsyncMock(return_value={"user_id": "u1"})
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Помечаем rid-1 как уже идущую (живая task).
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

    # rid-1 уже шла → schedule НЕ вызвался для неё; для rid-2 — вызвался.
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
        # Дать задачам войти в sleep().
        await asyncio.sleep(0.01)

        count = await agent_bridge_runner.shutdown_running(timeout_sec=1.0)

    assert count == 2
    assert cancelled_flags == {"rid-a": True, "rid-b": True}
    # add_done_callback должен убрать задачи из registry.
    assert agent_bridge_runner._running == {}


# ── _wait_via_coordinator: A+D — push 'final' event + fallback poll ──


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


def _patch_runner_deps(*, mock_conn, fake_req_repo, save_mock, poll_response_fn):
    """Возвращает контекст-менеджер с patch'ами для _run.

    poll_response_fn — async-функция (self, request_id) → dict | None.
    """
    from contextlib import ExitStack
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
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.poll_response",
            poll_response_fn,
        ),
    )
    stack.enter_context(
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    )
    return stack


async def test_final_event_triggers_immediate_save():
    """Фикс D (primary push): 'final' event в очереди координатора →
    runner сразу делает poll_response и сохраняет ассистент-сообщение,
    не дожидаясь срабатывания event_timeout.

    Сценарий: reasoning → 'final' → save с правильным content.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-final"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

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

    save_mock = AsyncMock()

    settings = _settings()
    # event_timeout специально большой: если бы фикс не работал,
    # runner ждал бы N секунд после reasoning'а до проверки response.
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        save_mock=save_mock,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-final",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=2.0,  # реальный timeout теста — не event_timeout
        )

    # save был вызван один раз с reasoning + text от final response.
    save_mock.assert_called_once()
    content = save_mock.call_args.kwargs["content"]
    assert content == [
        {
            "type": "reasoning",
            "content": "Думаю...",
            "block_id": "msg-1:reasoning:1",
        },
        {"type": "text", "content": "Ответ"},
    ]
    # 'final' event сам по себе НЕ попал в blocks (служебный маркер).
    assert all(b.get("type") != "final" for b in content)
    # poll_response был вызван — runner среагировал на 'final'.
    assert len(poll_calls) >= 1


async def test_fallback_poll_picks_response_without_final_event():
    """Фикс A (fallback poll): если 'final' event не пришёл (старая
    версия агента, ошибка записи и т.п.), runner всё равно подхватывает
    response через периодический poll_response — в пределах нескольких
    poll_interval-тиков, НЕ event_timeout.

    Сценарий: reasoning → тишина в queue, poll_response сначала None,
    потом response → save быстро.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-fallback"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

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
        # Первые 2 вызова — None (response ещё не записан),
        # затем — final_response.
        if poll_calls[0] < 3:
            return None
        return final_response

    save_mock = AsyncMock()

    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.01
    # event_timeout большой — если бы fallback не работал, тест бы упал
    # на wait_for(timeout=2.0).
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        save_mock=save_mock,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-fallback",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=2.0,
        )

    # save с собранными blocks.
    save_mock.assert_called_once()
    content = save_mock.call_args.kwargs["content"]
    assert content == [
        {
            "type": "reasoning",
            "content": "Размышляю",
            "block_id": "msg-1:reasoning:1",
        },
        {"type": "text", "content": "Готово"},
    ]
    # poll_response вызван несколько раз (fallback работает).
    assert poll_calls[0] >= 3


async def test_final_event_with_unwritten_response_continues_polling():
    """Race: 'final' event приходит, но agent_responses ещё не виден
    (репликация / snapshot isolation). Runner должен continue в цикл
    и подхватить response на следующем тике через fallback poll.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-race"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

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
        # Первый вызов (сразу после 'final') — None.
        # Последующие вызовы (fallback poll) — response.
        if call_counter[0] == 1:
            return None
        return final_response

    save_mock = AsyncMock()
    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.01
    settings.agent_bridge.event_timeout_sec = 60

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        save_mock=save_mock,
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

    # save сделан — runner не упал на гонке.
    save_mock.assert_called_once()
    content = save_mock.call_args.kwargs["content"]
    # reasoning'а в blocks нет — был только 'final', который НЕ блок.
    assert content == [{"type": "text", "content": "Ответ после race"}]
    # Минимум 2 вызова poll_response: после 'final' и из fallback poll.
    assert call_counter[0] >= 2


async def test_no_save_delay_after_last_event():
    """Регрессия описанного бага: между последним reasoning-событием и
    save'ом ассистент-сообщения проходит ≪ event_timeout_sec.

    До фикса A: после последнего события runner спал в queue.get() до
    срабатывания event_timeout (например, 110 сек) и только потом
    проверял response → save откладывался на ~event_timeout.
    После фикса A: wait_for ограничен poll_interval, response
    опрашивается каждый тик → save идёт за ≤ N×poll_interval.
    """
    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=_request_row("rid-delay"))
    fake_req_repo.update_status = AsyncMock(side_effect=[2, 3])
    fake_req_repo.finalize = AsyncMock(return_value=True)

    coordinator, queue_ref = _make_coord_with_events([
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
        # Делаем response доступным через короткое время после старта.
        if not response_available_at:
            response_available_at.append(now)
            return None
        response_picked_up_at.append(now)
        return final_response

    save_mock = AsyncMock()
    settings = _settings()
    settings.agent_bridge.poll_min_interval_sec = 0.02
    # КЛЮЧЕВОЕ: event_timeout большой. Если фикс не работает, save
    # произойдёт через ~event_timeout секунд после reasoning'а, и
    # asyncio.wait_for ниже упадёт с TimeoutError.
    settings.agent_bridge.event_timeout_sec = 10

    with _patch_runner_deps(
        mock_conn=mock_conn,
        fake_req_repo=fake_req_repo,
        save_mock=save_mock,
        poll_response_fn=fake_poll,
    ):
        await asyncio.wait_for(
            agent_bridge_runner._run(
                "rid-delay",
                settings=settings,
                coordinator=coordinator,
            ),
            timeout=1.0,  # сильно меньше event_timeout
        )

    save_mock.assert_called_once()
    # Реакция уложилась в несколько poll_interval, не в event_timeout.
    assert response_available_at and response_picked_up_at
    reaction_delay = response_picked_up_at[0] - response_available_at[0]
    assert reaction_delay < 1.0, (
        f"save отложился на {reaction_delay:.3f}s — больше разумного "
        f"числа poll_interval (= {settings.agent_bridge.poll_min_interval_sec}s)"
    )

