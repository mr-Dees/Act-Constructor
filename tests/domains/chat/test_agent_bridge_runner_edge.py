"""Edge-case тесты фонового раннера AgentBridgeRunner.

Покрывает сценарии из аудита `docs/chat-domain-audit-2026-05-13.md §4.5`:

1. Timeout по ``max_total_duration_sec`` — bridge сам ставит статус
   ``timeout`` перед raise; раннер должен сохранить error-блок и не
   падать. Также проверяем, что глобальный реестр ``_running`` не
   протекает.
2. Падение ``wait_for_completion`` с произвольным ``RuntimeError`` —
   ловится outer-except, runner ставит status='error' через второй
   ``get_db()`` контекст, реестр чистится.
3. Reconciliation: ``schedule_pending`` запускает задачу для каждой
   заклеймленной БД-записи; «свежие» request'ы (< 30s) фильтруются на
   уровне SQL (``claim_pending`` их не возвращает) — runner НЕ создаёт
   для них дубль-задачу к живому раннеру.
4. Конкурентные ``request_id`` на одной ``conversation_id`` — текущее
   поведение: cancel previous request не реализован, оба runner'а
   доходят до ``save_assistant_message`` независимо. Этот тест
   документирует поведение, чтобы регрессии замечались.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.chat.services import agent_bridge_runner
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры и хелперы
# -------------------------------------------------------------------------


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
    """get_db()-фабрика, возвращающая async-context-manager с моком conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


def _fake_get_db_ctx_multi(conns):
    """Возвращает фабрику get_db(), последовательно отдающую конн-ы из списка.

    Нужен для проверки сценариев, где runner открывает второй get_db()
    контекст для пометки status='error' после фатального исключения.
    """
    iterator = iter(conns)

    def factory():
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=next(iterator))
        ctx.__aexit__ = AsyncMock(return_value=False)
        return ctx

    return MagicMock(side_effect=factory)


# -------------------------------------------------------------------------
# 1. Timeout по max_total_duration_sec
# -------------------------------------------------------------------------


async def test_run_max_total_timeout_saves_error_and_clears_registry():
    """Когда bridge раскрывает AgentBridgeTimeout для max_total, runner:

    * сохраняет ассистент-сообщение с error-блоком ``agent_timeout``;
    * не вызывает повторный update_status (status='timeout' уже
      выставлен bridge'ем внутри гейта);
    * после завершения задачи запись чистится из ``_running``.
    """
    from app.domains.chat.services.agent_bridge import AgentBridgeTimeout

    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-mtd", "conversation_id": "conv-mtd", "status": "pending",
        "version": 1,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    save_mock = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def fake_wait(self, *a, **kw):
        # Имитация гейта max_total: bridge сам ставит status='timeout',
        # затем raise. В нашем моке status-update пропускаем — проверяем
        # реакцию runner'а на исключение.
        raise AgentBridgeTimeout(
            "max total duration 5s exceeded",
        )
        yield  # pragma: no cover

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
        # Прогоняем через schedule(), чтобы покрыть и регистрацию в _running.
        task = agent_bridge_runner.schedule("rid-mtd", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # Сохранили ровно один error-блок с правильным кодом.
    save_mock.assert_called_once()
    content = save_mock.call_args.kwargs["content"]
    assert any(
        b.get("type") == "error" and b.get("code") == "agent_timeout"
        for b in content
    ), f"ожидался error-блок agent_timeout, получено: {content}"

    # Runner НЕ вызывает update_status(timeout) сам — это работа bridge'а.
    statuses_set = [
        c.kwargs.get("status")
        for c in fake_req_repo.update_status.call_args_list
    ]
    assert "timeout" not in statuses_set, (
        "runner не должен сам выставлять timeout — это делает bridge "
        f"внутри гейта; получено: {statuses_set}"
    )

    # Реестр почищен done_callback'ом.
    assert "rid-mtd" not in agent_bridge_runner._running


# -------------------------------------------------------------------------
# 2. Pending → error при произвольном исключении в poll
# -------------------------------------------------------------------------


async def test_run_marks_error_on_poll_runtime_exception():
    """Если ``wait_for_completion`` падает с RuntimeError (не Timeout),
    runner ловит на outer-except и помечает request status='error'
    через отдельный get_db()-контекст. Реестр чистится."""

    mock_conn = AsyncMock()
    mock_conn2 = AsyncMock()  # для второго get_db()-вызова (error path)
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-err", "conversation_id": "conv-err", "status": "pending",
        "version": 1,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    save_mock = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def fake_wait_raises(self, *a, **kw):
        raise RuntimeError("DB poll failure")
        yield  # pragma: no cover

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx_multi([mock_conn, mock_conn2]),
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
            fake_wait_raises,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        task = agent_bridge_runner.schedule("rid-err", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # save_assistant_message не вызывался (мы упали ДО _translate_buttons/save).
    save_mock.assert_not_called()

    # Был хотя бы один вызов update_status со status='error'.
    error_calls = [
        c for c in fake_req_repo.update_status.call_args_list
        if c.kwargs.get("status") == "error"
    ]
    assert error_calls, (
        "ожидался update_status(error) в outer-except, "
        f"получены вызовы: {fake_req_repo.update_status.call_args_list}"
    )

    # Реестр почищен.
    assert "rid-err" not in agent_bridge_runner._running


async def test_run_marks_error_when_get_request_raises():
    """Если падение случилось раньше — при чтении request_repo.get() —
    runner всё равно должен пометить запись error через резервный
    get_db()-контекст."""
    mock_conn = AsyncMock()
    mock_conn2 = AsyncMock()

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(side_effect=RuntimeError("conn dropped"))
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx_multi([mock_conn, mock_conn2]),
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
    ):
        task = agent_bridge_runner.schedule("rid-getfail", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # Хотя бы один error-вызов в reserve-контексте.
    error_calls = [
        c for c in fake_req_repo.update_status.call_args_list
        if c.kwargs.get("status") == "error"
    ]
    assert error_calls, "ожидался резервный update_status(error)"

    assert "rid-getfail" not in agent_bridge_runner._running


# -------------------------------------------------------------------------
# 3. Reconciliation: свежие request'ы (< older_than_sec) не клеймятся
# -------------------------------------------------------------------------


async def test_schedule_pending_fresh_requests_filtered_by_sql():
    """Свежие request'ы (< older_than_sec, в данном случае 30s) не
    должны подхватываться reconcile'ом: ``claim_pending`` фильтрует
    их на уровне SQL через ``updated_at < now() - interval``.

    Здесь моком эмулируем БД, которая для младших записей возвращает
    пустой список (т.е. SQL-фильтр сработал). Проверяем, что для
    таких записей ``schedule()`` НЕ вызывается, чтобы избежать дубля
    с уже живым раннером (in-process защита).
    """
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    # claim_pending возвращает пусто (все pending записи моложе порога).
    fake_req_repo.claim_pending = AsyncMock(return_value=[])
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    scheduled: list[str] = []

    def fake_schedule(rid, *, settings):  # noqa: ARG001
        scheduled.append(rid)
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

    assert count == 0
    assert scheduled == []
    # claim_pending звался с правильным порогом (30s) — это и есть
    # SQL-фильтр для свежих записей.
    fake_req_repo.claim_pending.assert_awaited_once()
    assert (
        fake_req_repo.claim_pending.call_args.kwargs["older_than_sec"] == 30
    )


async def test_schedule_pending_does_not_duplicate_running_task():
    """Reconcile-фильтр in-process: если для request_id уже крутится
    задача в текущем процессе, schedule() для неё не вызывается, даже
    если БД-claim случайно вернул её id (например, после ручного
    повторного forward в том же процессе)."""
    mock_conn = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.claim_pending = AsyncMock(return_value=["rid-live"])
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Регистрируем "живую" задачу под этим id ДО reconcile.
    async def _noop():
        await asyncio.sleep(10)
    live = asyncio.create_task(_noop())
    agent_bridge_runner._running["rid-live"] = live

    scheduled: list[str] = []

    def fake_schedule(rid, *, settings):  # noqa: ARG001
        scheduled.append(rid)
        return MagicMock()

    try:
        with (
            patch("app.db.connection.get_db", _fake_get_db_ctx(mock_conn)),
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
                settings=_settings(), older_than_sec=30,
            )
    finally:
        live.cancel()

    assert count == 0
    assert scheduled == [], (
        "schedule() не должен вызываться для request_id, по которому уже "
        "идёт фоновая задача в этом процессе"
    )


# -------------------------------------------------------------------------
# 4. Конкурентные request_id на одной conversation_id
# -------------------------------------------------------------------------


async def test_concurrent_requests_on_same_conversation_both_save():
    """Документирует текущее поведение: при двух подряд forward-вызовах
    в одну conversation_id создаются ДВА разных request_id, оба
    раннера работают независимо и оба зовут save_assistant_message.

    «Cancel previous request» сейчас не реализован — это сознательное
    проектное решение: внешний агент уже потратил ресурсы на R1,
    дожидаемся ответа. Пользователь увидит обе реплики в истории.

    Если в будущем добавим cancel-previous — этот тест должен
    обновиться, чтобы R1 завершался без save_assistant_message.
    """
    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    mock_conn = AsyncMock()
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Один общий conversation_id, разные request_id.
    requests_by_id = {
        "R1": {
            "id": "R1", "conversation_id": "conv-shared",
            "status": "pending", "version": 1,
        },
        "R2": {
            "id": "R2", "conversation_id": "conv-shared",
            "status": "pending", "version": 1,
        },
    }

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        side_effect=lambda rid: requests_by_id.get(rid),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)

    async def fake_wait(self, *a, **kw):
        # Каждый раннер мгновенно получает свой финальный ответ.
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "ответ"}],
            "token_usage": {},
        })

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
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.save_assistant_message",
            save_mock,
        ),
    ):
        t1 = agent_bridge_runner.schedule("R1", settings=_settings())
        t2 = agent_bridge_runner.schedule("R2", settings=_settings())
        # Разные task'и в registry.
        assert t1 is not t2
        assert agent_bridge_runner._running["R1"] is t1
        assert agent_bridge_runner._running["R2"] is t2

        await asyncio.gather(
            asyncio.wait_for(t1, timeout=2.0),
            asyncio.wait_for(t2, timeout=2.0),
        )

    # Оба runner'а сохранили сообщение — это и есть зафиксированное
    # текущее поведение (no cancel-previous semantics).
    assert save_mock.await_count == 2
    saved_convs = [
        c.kwargs["conversation_id"]
        for c in save_mock.await_args_list
    ]
    assert saved_convs == ["conv-shared", "conv-shared"]

    # Реестр почищен по обоим request'ам.
    assert "R1" not in agent_bridge_runner._running
    assert "R2" not in agent_bridge_runner._running


async def test_schedule_same_request_id_returns_same_task():
    """Параллельное смежное: повторный schedule() для того же
    request_id возвращает уже идущую задачу — идемпотентность защищает
    от двойного save в один request_id (например, при двойном
    reconcile+forward гонке в одном процессе)."""
    started = asyncio.Event()

    async def fake_run(_rid, *, settings):  # noqa: ARG001
        started.set()
        await asyncio.sleep(10)

    with patch.object(agent_bridge_runner, "_run", fake_run):
        t1 = agent_bridge_runner.schedule("R-idem", settings=_settings())
        await asyncio.wait_for(started.wait(), timeout=1.0)
        t2 = agent_bridge_runner.schedule("R-idem", settings=_settings())

    assert t1 is t2
    t1.cancel()
