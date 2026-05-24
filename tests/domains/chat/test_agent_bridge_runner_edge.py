"""Edge-case тесты фонового раннера AgentBridgeRunner.

Покрывает три сценария, которые happy-path в `test_agent_bridge_runner.py`
не трогает:

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
   доходят до ``finalize_assistant_message`` независимо. Этот тест
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
    s.agent_bridge.poll_min_interval_sec = 0.01
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

    * зовёт fail_assistant_message с error-блоком ``agent_timeout`` —
      chat_messages.status='failed', блок дописан;
    * не вызывает повторный update_status(timeout) (status уже
      выставлен bridge'ем внутри гейта);
    * не вызывает finalize_assistant_message (стрим не успешен);
    * после завершения задачи запись чистится из ``_running``.
    """
    from app.domains.chat.services.agent_bridge import AgentBridgeTimeout

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-mtd", "conversation_id": "conv-mtd",
        "message_id": "msg-mtd", "status": "pending", "version": 1,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = MagicMock()
    fake_msg_repo.append_block = AsyncMock(return_value=True)
    fail_mock = AsyncMock(return_value=True)
    finalize_msg_mock = AsyncMock(return_value=True)
    start_mock = AsyncMock(return_value={
        "id": "msg-mtd", "status": "streaming", "content": [],
    })
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def fake_wait(self, *a, **kw):
        # Имитация гейта max_total: bridge сам ставит status='timeout',
        # затем raise.
        raise AgentBridgeTimeout("max total duration 5s exceeded")
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
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.fail_assistant_message",
            fail_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
    ):
        task = agent_bridge_runner.schedule("rid-mtd", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # fail_assistant_message вызван с error-блоком agent_timeout.
    fail_mock.assert_awaited_once()
    error_block = fail_mock.call_args.kwargs["error_block"]
    assert error_block["type"] == "error"
    assert error_block["code"] == "agent_timeout"

    # finalize_assistant_message не вызывался (стрим не успешен).
    finalize_msg_mock.assert_not_awaited()

    # Runner НЕ вызывает update_status(timeout) сам — это работа bridge'а.
    statuses_set = [
        c.kwargs.get("status")
        for c in fake_req_repo.update_status.call_args_list
    ]
    assert "timeout" not in statuses_set

    # Реестр почищен done_callback'ом.
    assert "rid-mtd" not in agent_bridge_runner._running


# -------------------------------------------------------------------------
# 2. Pending → error при произвольном исключении в poll
# -------------------------------------------------------------------------


async def test_run_marks_error_on_poll_runtime_exception():
    """Если ``wait_for_completion`` падает с RuntimeError (не Timeout),
    runner ловит на outer-except и помечает request status='error'
    через отдельный get_db()-контекст. Реестр чистится.

    После декомпозиции ``_run()`` на фазы коннектов берётся четыре:
    Phase 1 (initial read + dispatch), Phase 1b (start_streaming —
    Phase 1 «D»), Phase 2 fallback path (`_wait_via_fallback` сам
    открывает свой `async with get_db()` под bridge.wait_for_completion),
    и резервный outer-except для пометки status='error'.
    """

    mock_conn = AsyncMock()
    mock_conn_stream = AsyncMock()  # Phase 1b (start_streaming)
    mock_conn2 = AsyncMock()  # Phase 2 fallback
    mock_conn3 = AsyncMock()  # outer-except recovery (mark error)
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-err", "conversation_id": "conv-err",
        "message_id": "msg-err", "status": "pending", "version": 1,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    finalize_msg_mock = AsyncMock()
    fail_mock = AsyncMock()
    start_mock = AsyncMock(return_value={
        "id": "msg-err", "status": "streaming", "content": [],
    })
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def fake_wait_raises(self, *a, **kw):
        raise RuntimeError("DB poll failure")
        yield  # pragma: no cover

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx_multi(
                [mock_conn, mock_conn_stream, mock_conn2, mock_conn3],
            ),
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
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.fail_assistant_message",
            fail_mock,
        ),
    ):
        task = agent_bridge_runner.schedule("rid-err", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # finalize_assistant_message не вызывался (упали ДО финала).
    finalize_msg_mock.assert_not_awaited()
    # fail_assistant_message тоже — runner упал на RuntimeError, не на
    # AgentBridgeTimeout, поэтому идёт по outer-except path, а не по
    # явному timeout-handler'у.
    fail_mock.assert_not_awaited()

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

    def fake_schedule(rid, *, settings, coordinator=None):  # noqa: ARG001
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
    fake_req_repo.get = AsyncMock(return_value={"user_id": "u1"})
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Регистрируем "живую" задачу под этим id ДО reconcile.
    async def _noop():
        await asyncio.sleep(10)
    live = asyncio.create_task(_noop())
    agent_bridge_runner._running["rid-live"] = live

    scheduled: list[str] = []

    def fake_schedule(rid, *, settings, coordinator=None):  # noqa: ARG001
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
    раннера работают независимо и оба зовут finalize_assistant_message
    с разными message_id.

    «Cancel previous request» сейчас не реализован.
    """
    from app.domains.chat.services.agent_bridge import AgentBridgeUpdate

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    requests_by_id = {
        "R1": {
            "id": "R1", "conversation_id": "conv-shared",
            "message_id": "msg-R1", "status": "pending", "version": 1,
        },
        "R2": {
            "id": "R2", "conversation_id": "conv-shared",
            "message_id": "msg-R2", "status": "pending", "version": 1,
        },
    }

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(
        side_effect=lambda rid: requests_by_id.get(rid),
    )
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    fake_msg_repo = MagicMock()
    fake_msg_repo.append_block = AsyncMock(return_value=True)

    async def fake_wait(self, *a, **kw):
        yield AgentBridgeUpdate(response={
            "blocks": [{"type": "text", "content": "ответ"}],
            "token_usage": {},
        })

    start_mock = AsyncMock(return_value={
        "id": "msg-stub", "status": "streaming", "content": [],
    })
    finalize_msg_mock = AsyncMock(return_value=True)

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
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
    ):
        t1 = agent_bridge_runner.schedule("R1", settings=_settings())
        t2 = agent_bridge_runner.schedule("R2", settings=_settings())
        assert t1 is not t2
        assert agent_bridge_runner._running["R1"] is t1
        assert agent_bridge_runner._running["R2"] is t2

        await asyncio.gather(
            asyncio.wait_for(t1, timeout=2.0),
            asyncio.wait_for(t2, timeout=2.0),
        )

    # Оба runner'а финализировали сообщения для общего conv_id.
    assert finalize_msg_mock.await_count == 2
    saved_convs = [
        c.kwargs["conversation_id"]
        for c in finalize_msg_mock.await_args_list
    ]
    assert saved_convs == ["conv-shared", "conv-shared"]
    # Но message_id'ы разные.
    message_ids = sorted(
        c.kwargs["message_id"]
        for c in finalize_msg_mock.await_args_list
    )
    assert message_ids == ["msg-R1", "msg-R2"]

    assert "R1" not in agent_bridge_runner._running
    assert "R2" not in agent_bridge_runner._running


async def test_schedule_same_request_id_returns_same_task():
    """Параллельное смежное: повторный schedule() для того же
    request_id возвращает уже идущую задачу — идемпотентность защищает
    от двойного save в один request_id (например, при двойном
    reconcile+forward гонке в одном процессе)."""
    started = asyncio.Event()

    async def fake_run(_rid, *, settings, coordinator=None):  # noqa: ARG001
        started.set()
        await asyncio.sleep(10)

    with patch.object(agent_bridge_runner, "_run", fake_run):
        t1 = agent_bridge_runner.schedule("R-idem", settings=_settings())
        await asyncio.wait_for(started.wait(), timeout=1.0)
        t2 = agent_bridge_runner.schedule("R-idem", settings=_settings())

    assert t1 is t2
    t1.cancel()


# -------------------------------------------------------------------------
# 5. Лимит размера текста блока (CH-1 / DB-1)
# -------------------------------------------------------------------------


def test_trim_text_if_oversized_trims_oversized_reasoning(caplog):
    """Reasoning >max_size обрезается, маркер дописан, WARNING в лог."""
    import logging

    max_size = 256 * 1024  # 256 KB
    # 300 KB ASCII (1 байт/символ)
    big_text = "a" * (300 * 1024)

    caplog.set_level(
        logging.WARNING,
        logger="audit_workstation.domains.chat.agent_bridge_runner",
    )
    result = agent_bridge_runner._trim_text_if_oversized(
        text=big_text,
        max_size=max_size,
        request_id="rid-trim",
        block_type="reasoning",
    )

    # Размер укладывается в лимит (с учётом маркера)
    assert len(result.encode("utf-8")) <= max_size
    # Маркер на месте
    assert result.endswith("…[обрезано]")
    # Содержание начала сохранено
    assert result.startswith("aaaa")
    # WARNING зафиксирован
    assert any(
        "блок обрезан" in r.message and "rid-trim" in r.message
        and "reasoning" in r.message
        for r in caplog.records
    )


def test_trim_text_if_oversized_passes_through_small_text(caplog):
    """Текст в пределах лимита не обрезается, WARNING не эмитится."""
    import logging

    caplog.set_level(
        logging.WARNING,
        logger="audit_workstation.domains.chat.agent_bridge_runner",
    )
    small_text = "Короткое reasoning от агента."
    result = agent_bridge_runner._trim_text_if_oversized(
        text=small_text,
        max_size=256 * 1024,
        request_id="rid-small",
        block_type="reasoning",
    )
    assert result == small_text
    # WARNING не должен эмититься для небольших блоков
    assert not any("блок обрезан" in r.message for r in caplog.records)


def test_trim_text_preserves_utf8_boundary():
    """Обрезка не разрывает UTF-8 multibyte-символ.

    Кириллица — 2 байта/символ. После обрезки результат должен оставаться
    валидным UTF-8 (декодируется без ошибок).
    """
    # 200000 кириллических символов = 400000 байт (> 256 KB)
    big_text = "я" * 200000
    result = agent_bridge_runner._trim_text_if_oversized(
        text=big_text,
        max_size=256 * 1024,
        request_id="rid-utf8",
        block_type="reasoning",
    )
    # Декодируется ровно (без UnicodeDecodeError)
    encoded = result.encode("utf-8")
    encoded.decode("utf-8")  # raises если граница битая
    assert len(encoded) <= 256 * 1024
    assert result.endswith("…[обрезано]")


def test_trim_text_empty_returns_empty():
    """Пустой текст возвращается как есть (быстрый путь без encode)."""
    result = agent_bridge_runner._trim_text_if_oversized(
        text="",
        max_size=1024,
        request_id="rid-empty",
        block_type="reasoning",
    )
    assert result == ""


# -------------------------------------------------------------------------
# 6. forward_limit декрементится в finally при exception в середине стрима
# -------------------------------------------------------------------------


async def test_run_releases_forward_limit_on_mid_stream_exception():
    """Если runner падает с RuntimeError ПОСЛЕ acquire — счётчик должен
    декрементироваться в finally блоке ``_run``.

    Регрессия: без release в finally при сбое БД / runner crash юзер
    остаётся с инкрементированным счётчиком навсегда — новые forward'ы
    отбиваются 429 до рестарта uvicorn.
    """
    from app.domains.chat.services import forward_limit

    # Симулируем acquire: счётчик=1, как будто handle_forward_call успел
    # инкрементировать перед schedule().
    forward_limit.reset()
    forward_limit.acquire_no_check("user-mid-fail")
    assert forward_limit.get_count("user-mid-fail") == 1

    mock_conn = AsyncMock()
    mock_conn_stream = AsyncMock()
    mock_conn2 = AsyncMock()
    mock_conn3 = AsyncMock()
    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-mid", "conversation_id": "conv-mid",
        "message_id": "msg-mid", "status": "pending", "version": 1,
        "user_id": "user-mid-fail",
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    finalize_msg_mock = AsyncMock()
    fail_mock = AsyncMock()
    start_mock = AsyncMock(return_value={
        "id": "msg-mid", "status": "streaming", "content": [],
    })
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    async def fake_wait_raises(self, *a, **kw):
        # Бросаем RuntimeError В СЕРЕДИНЕ стрима после того, как
        # runner уже принял request и пометил его dispatched.
        raise RuntimeError("DB пропала посреди стрима")
        yield  # pragma: no cover

    with (
        patch(
            "app.db.connection.get_db",
            _fake_get_db_ctx_multi(
                [mock_conn, mock_conn_stream, mock_conn2, mock_conn3],
            ),
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
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.fail_assistant_message",
            fail_mock,
        ),
    ):
        task = agent_bridge_runner.schedule("rid-mid", settings=_settings())
        await asyncio.wait_for(task, timeout=2.0)

    # finally в _run обязан декрементировать счётчик до 0
    assert forward_limit.get_count("user-mid-fail") == 0, (
        "forward_limit.release не вызван в finally — юзер «застрял» в лимите"
    )
    forward_limit.reset()
