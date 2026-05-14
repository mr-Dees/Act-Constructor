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
    s.agent_bridge.poll_interval_sec = 0.01
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

    async def fake_run(_rid, *, settings):  # noqa: ARG001
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

    # AgentRequestRepository.get → возвращает запрос со status='pending'.
    request_row = {
        "id": "rid-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
    }
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value=request_row)
    fake_req_repo.update_status = AsyncMock()

    # bridge.wait_for_completion → yield reasoning event + final response.
    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(event={
            "id": 1, "event_type": "reasoning",
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
    save_mock.assert_called_once()
    kw = save_mock.call_args.kwargs
    assert kw["conversation_id"] == "conv-1"
    assert kw["content"] == [
        {"type": "reasoning", "content": "Думаю..."},
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


async def test_run_saves_timeout_error_block_on_bridge_timeout():
    """Если bridge выбрасывает AgentBridgeTimeout, раннер всё равно
    сохраняет сообщение с блоком-ошибкой (чтобы пользователь увидел контекст)."""
    from app.domains.chat.services.agent_bridge import AgentBridgeTimeout

    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1", "conversation_id": "conv-1", "status": "pending",
    })
    fake_req_repo.update_status = AsyncMock()
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
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    started = []

    def fake_schedule(rid, *, settings):  # noqa: ARG001
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
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Помечаем rid-1 как уже идущую (живая task).
    async def _noop():
        await asyncio.sleep(10)
    live_task = asyncio.create_task(_noop())
    agent_bridge_runner._running["rid-1"] = live_task

    called_with: list[str] = []

    def fake_schedule(rid, *, settings):  # noqa: ARG001
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

    async def long_run(rid, *, settings):  # noqa: ARG001
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


