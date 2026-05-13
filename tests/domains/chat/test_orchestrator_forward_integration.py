"""Интеграционный тест: Orchestrator.run_stream -> forward -> bridge -> SSE.

LLM возвращает tool-call chat.forward_to_knowledge_agent.
Параллельный «агент» симулируется через мокирование AgentBridgeService.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.chat.tools import register_tools, reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.integrations.chat_tools import get_chat_tools
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _clean_registries():
    """Сброс глобальных реестров между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    register_tools(get_chat_tools())
    yield
    reset_registry()
    reset_settings()
    reset_tools()


def _stream_chunks(tool_call_id: str, args_json: str):
    """Имитация дельт от LLM, эквивалентная одному tool-call."""
    NS = type("NS", (), {})

    def mk(content=None, tool_calls=None, finish_reason=None):
        ch = NS()
        ch.choices = [NS()]
        ch.choices[0].delta = NS()
        ch.choices[0].delta.content = content
        ch.choices[0].delta.tool_calls = tool_calls
        ch.choices[0].delta.reasoning_details = None
        ch.choices[0].finish_reason = finish_reason
        return ch

    def tc(index, tc_id=None, name=None, args=None):
        t = NS()
        t.index = index
        t.id = tc_id
        if name or args:
            t.function = NS()
            t.function.name = name
            t.function.arguments = args
        else:
            t.function = None
        return t

    return [
        mk(tool_calls=[tc(0, tool_call_id, "chat.forward_to_knowledge_agent", args_json)]),
        mk(finish_reason="tool_calls"),
    ]


async def _async_iter(items):
    for x in items:
        yield x


async def test_forward_tool_call_streams_reasoning_and_final(monkeypatch):
    """Полный путь: LLM -> forward -> имитация агента -> SSE-блоки."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )
    settings.agent_bridge.poll_interval_sec = 0.01
    settings.agent_bridge.initial_response_timeout_sec = 5
    settings.agent_bridge.event_timeout_sec = 5
    settings.agent_bridge.max_total_duration_sec = 5

    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = AsyncMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    # Мокируем LLM-клиент так, чтобы он возвращал stream с tool-call'ом
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(
        return_value=_async_iter(_stream_chunks(
            tool_call_id="tc_1",
            args_json='{"question":"Что такое КСО?"}',
        )),
    )
    monkeypatch.setattr(orch, "_get_openai_client", lambda: fake_client)

    # Мокируем мост: на send -> request_id; wait_for_completion -> один
    # reasoning event и финальный response.
    from app.domains.chat.services.agent_bridge import (
        AgentBridgeService,
        AgentBridgeUpdate,
    )

    async def fake_wait_for_completion(
        self, request_id, *, poll_interval_sec,
        initial_response_timeout_sec, event_timeout_sec, max_total_duration_sec,
    ):
        yield AgentBridgeUpdate(event={
            "id": 1,
            "request_id": request_id,
            "seq": 1,
            "event_type": "reasoning",
            "payload": {"text": "Думаю..."},
            "created_at": None,
        })
        yield AgentBridgeUpdate(response={
            "id": "resp-1",
            "request_id": request_id,
            "blocks": [{"type": "text", "content": "КСО — это ..."}],
            "finish_reason": "stop",
            "token_usage": None,
            "model": "imitated",
            "created_at": None,
        })

    monkeypatch.setattr(
        AgentBridgeService,
        "send",
        AsyncMock(return_value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    )
    monkeypatch.setattr(
        AgentBridgeService,
        "wait_for_completion",
        fake_wait_for_completion,
    )

    # _handle_forward_call открывает get_db() — подсовываем фиктивное соединение.
    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    # AgentBridgeService/репозитории при инициализации зовут get_adapter().
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Сохранение ассистент-сообщения теперь делает фоновый раннер
    # (agent_bridge_runner). В тесте мы не запускаем реальный раннер — только
    # проверяем, что оркестратор корректно зарегистрировал задачу.
    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
        patch(
            "app.domains.chat.services.agent_bridge_runner.schedule",
        ) as runner_schedule,
    ):
        async for ev in orch.run_stream(
            conversation_id="conv-1",
            user_message="Что такое КСО?",
            domains=["chat"],
            file_blocks=[],
            message_id="msg-1",
            user_id="u",
            knowledge_bases=["acts_default"],
        ):
            events.append(ev)

    # SSE-стрим должен содержать tool_call для forward, затем reasoning-блок
    # (полный триплет start+delta+end на один чанк), затем финальный
    # text-блок, и message_end.
    text = "\n".join(events)
    assert "chat.forward_to_knowledge_agent" in text
    assert "Думаю" in text  # reasoning
    assert "КСО — это" in text  # финальный ответ
    assert "message_end" in text

    # Должно быть событие agent_request_started с request_id — фронт его
    # использует для resume-стрима при разрыве соединения.
    assert any(
        isinstance(e, str) and "agent_request_started" in e
        for e in events
    )

    # Один reasoning-чанк → один полный block_start/end триплет
    # с типом "reasoning".
    reasoning_starts = [
        e for e in events
        if isinstance(e, str)
        and "block_start" in e and '"type": "reasoning"' in e
    ]
    assert len(reasoning_starts) == 1
    # И один соответствующий block_end на ту же reasoning-индексацию
    # (в данном тесте — block_index=0).
    assert any(
        isinstance(e, str)
        and "block_end" in e and '"index": 0' in e
        for e in events
    )

    # Оркестратор должен запустить фоновый раннер для этого request_id —
    # именно он отвечает за сохранение ответа в БД, даже если клиент
    # закрыл вкладку посреди стрима.
    runner_schedule.assert_called_once()
    call_kwargs = runner_schedule.call_args
    assert call_kwargs.args[0] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


async def test_forward_emits_separate_block_per_reasoning_chunk(monkeypatch):
    """Несколько reasoning-событий → отдельный block_start/end триплет на каждый."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )
    settings.agent_bridge.poll_interval_sec = 0.01
    settings.agent_bridge.initial_response_timeout_sec = 5
    settings.agent_bridge.event_timeout_sec = 5
    settings.agent_bridge.max_total_duration_sec = 5

    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = AsyncMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(
        return_value=_async_iter(_stream_chunks(
            tool_call_id="tc_1",
            args_json='{"question":"Q"}',
        )),
    )
    monkeypatch.setattr(orch, "_get_openai_client", lambda: fake_client)

    from app.domains.chat.services.agent_bridge import (
        AgentBridgeService,
        AgentBridgeUpdate,
    )

    chunks = ["Чанк 1.", "Чанк 2.", "Чанк 3."]

    async def fake_wait_for_completion(
        self, request_id, *, poll_interval_sec,
        initial_response_timeout_sec, event_timeout_sec, max_total_duration_sec,
    ):
        for i, t in enumerate(chunks, start=1):
            yield AgentBridgeUpdate(event={
                "id": i,
                "request_id": request_id,
                "seq": i,
                "event_type": "reasoning",
                "payload": {"text": t},
                "created_at": None,
            })
        yield AgentBridgeUpdate(response={
            "id": "resp-1",
            "request_id": request_id,
            "blocks": [{"type": "text", "content": "Финал"}],
            "finish_reason": "stop",
            "token_usage": None,
            "model": "imitated",
            "created_at": None,
        })

    monkeypatch.setattr(
        AgentBridgeService,
        "send",
        AsyncMock(return_value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    )
    monkeypatch.setattr(
        AgentBridgeService,
        "wait_for_completion",
        fake_wait_for_completion,
    )
    # Подменяем фоновый раннер — он тестируется отдельно.
    monkeypatch.setattr(
        "app.domains.chat.services.agent_bridge_runner.schedule",
        lambda *a, **kw: None,
    )

    orch._save_assistant_message = AsyncMock()

    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
    ):
        async for ev in orch.run_stream(
            conversation_id="conv-1",
            user_message="Q",
            domains=["chat"],
            file_blocks=[],
            message_id="msg-1",
            user_id="u",
            knowledge_bases=["acts_default"],
        ):
            events.append(ev)

    # Должно быть ровно 3 reasoning block_start события — по одному на чанк,
    # с уникальными индексами.
    reasoning_starts = [
        e for e in events
        if isinstance(e, str)
        and "block_start" in e and '"type": "reasoning"' in e
    ]
    assert len(reasoning_starts) == 3, (
        f"ожидалось 3 reasoning block_start, получено {len(reasoning_starts)}"
    )

    # И ровно 3 block_delta с текстами чанков
    for chunk_text in chunks:
        assert any(
            isinstance(e, str)
            and "block_delta" in e and chunk_text in e
            for e in events
        ), f"не найдена дельта с текстом {chunk_text!r}"

    # Каждый из reasoning-блоков должен иметь свой block_end —
    # ищем block_end с индексами 0, 1, 2.
    for idx in (0, 1, 2):
        assert any(
            isinstance(e, str)
            and "block_end" in e and f'"index": {idx}' in e
            for e in events
        ), f"не найден block_end для индекса {idx}"

    # Финальный text-блок должен идти с block_index=3 (после трёх reasoning).
    assert any(
        isinstance(e, str)
        and "block_start" in e
        and '"type": "text"' in e
        and '"index": 3' in e
        for e in events
    )


def _setup_forward_with_response_blocks(monkeypatch, orch, response_blocks):
    """Хелпер: настраивает мок LLM/моста, возвращающий заданные финальные блоки."""
    fake_client = MagicMock()
    fake_client.chat.completions.create = AsyncMock(
        return_value=_async_iter(_stream_chunks(
            tool_call_id="tc_1",
            args_json='{"question":"Q"}',
        )),
    )
    monkeypatch.setattr(orch, "_get_openai_client", lambda: fake_client)

    from app.domains.chat.services.agent_bridge import (
        AgentBridgeService,
        AgentBridgeUpdate,
    )

    async def fake_wait_for_completion(
        self, request_id, *, poll_interval_sec,
        initial_response_timeout_sec, event_timeout_sec, max_total_duration_sec,
    ):
        yield AgentBridgeUpdate(response={
            "id": "resp-1",
            "request_id": request_id,
            "blocks": response_blocks,
            "finish_reason": "stop",
            "token_usage": None,
            "model": "imitated",
            "created_at": None,
        })

    monkeypatch.setattr(
        AgentBridgeService,
        "send",
        AsyncMock(return_value="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    )
    monkeypatch.setattr(
        AgentBridgeService,
        "wait_for_completion",
        fake_wait_for_completion,
    )

    orch._save_assistant_message = AsyncMock()
    # Подменяем фоновый раннер: в этих тестах нам важна только SSE-эмиссия,
    # сохранение сообщения проверяется отдельным юнит-тестом на раннер.
    monkeypatch.setattr(
        "app.domains.chat.services.agent_bridge_runner.schedule",
        lambda *a, **kw: None,
    )


async def test_buttons_block_emits_sse_buttons_not_block_start(monkeypatch):
    """Финальный buttons-блок эмитится как event:buttons, без block_start/end."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )
    settings.agent_bridge.poll_interval_sec = 0.01
    settings.agent_bridge.initial_response_timeout_sec = 5
    settings.agent_bridge.event_timeout_sec = 5
    settings.agent_bridge.max_total_duration_sec = 5

    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = AsyncMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    buttons_payload = [
        {"action_id": "open_url", "label": "Test", "params": {"url": "/test"}},
    ]
    _setup_forward_with_response_blocks(
        monkeypatch, orch,
        response_blocks=[{"type": "buttons", "buttons": buttons_payload}],
    )

    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
    ):
        async for ev in orch.run_stream(
            conversation_id="conv-1",
            user_message="Q",
            domains=["chat"],
            file_blocks=[],
            message_id="msg-1",
            user_id="u",
            knowledge_bases=["acts_default"],
        ):
            events.append(ev)

    # Ровно одно event: buttons с нужным payload
    buttons_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: buttons")
    ]
    assert len(buttons_events) == 1
    assert "open_url" in buttons_events[0]
    assert "/test" in buttons_events[0]

    # И ноль block_start/block_end с типом buttons
    assert not any(
        isinstance(e, str)
        and "block_start" in e and '"type": "buttons"' in e
        for e in events
    )
    assert not any(
        isinstance(e, str)
        and "block_end" in e and '"index": 0' in e
        for e in events
    )


async def test_text_and_buttons_in_same_response_each_renders_correctly(monkeypatch):
    """Text получает block_start/delta/end с index=0; buttons — отдельный канал."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )
    settings.agent_bridge.poll_interval_sec = 0.01
    settings.agent_bridge.initial_response_timeout_sec = 5
    settings.agent_bridge.event_timeout_sec = 5
    settings.agent_bridge.max_total_duration_sec = 5

    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = AsyncMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    buttons_payload = [
        {"action_id": "open_url", "label": "Открыть", "params": {"url": "/x"}},
    ]
    _setup_forward_with_response_blocks(
        monkeypatch, orch,
        response_blocks=[
            {"type": "text", "content": "Готово."},
            {"type": "buttons", "buttons": buttons_payload},
        ],
    )

    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
    ):
        async for ev in orch.run_stream(
            conversation_id="conv-1",
            user_message="Q",
            domains=["chat"],
            file_blocks=[],
            message_id="msg-1",
            user_id="u",
            knowledge_bases=["acts_default"],
        ):
            events.append(ev)

    # Text-блок: block_start(index=0,type=text) + block_delta + block_end(index=0)
    assert any(
        isinstance(e, str)
        and "block_start" in e
        and '"type": "text"' in e and '"index": 0' in e
        for e in events
    )
    assert any(
        isinstance(e, str)
        and "block_delta" in e
        and '"index": 0' in e and "Готово" in e
        for e in events
    )
    assert any(
        isinstance(e, str)
        and "block_end" in e and '"index": 0' in e
        for e in events
    )

    # buttons — ровно одно event:buttons; никаких block_start/end с buttons
    buttons_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: buttons")
    ]
    assert len(buttons_events) == 1
    assert "Открыть" in buttons_events[0]

    assert not any(
        isinstance(e, str)
        and "block_start" in e and '"type": "buttons"' in e
        for e in events
    )

    # Нет коллизии индексов: только один block_start с index=0 (text)
    block_starts_idx0 = [
        e for e in events
        if isinstance(e, str) and "block_start" in e and '"index": 0' in e
    ]
    assert len(block_starts_idx0) == 1


# ── server-side button translation (Fix B) ──


async def _run_forward_and_collect_events(monkeypatch, response_blocks):
    """Гоняет run_stream через forward с заданными response_blocks; возвращает events."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        streaming_enabled=True,
    )
    settings.agent_bridge.poll_interval_sec = 0.01
    settings.agent_bridge.initial_response_timeout_sec = 5
    settings.agent_bridge.event_timeout_sec = 5
    settings.agent_bridge.max_total_duration_sec = 5

    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = AsyncMock()

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )
    _setup_forward_with_response_blocks(monkeypatch, orch, response_blocks)

    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
    ):
        async for ev in orch.run_stream(
            conversation_id="conv-1",
            user_message="Q",
            domains=["chat"],
            file_blocks=[],
            message_id="msg-1",
            user_id="u",
            knowledge_bases=["acts_default"],
        ):
            events.append(ev)
    return events, orch


async def test_orchestrator_translates_buttons_with_backend_action_ids(
    monkeypatch,
):
    """Кнопки с action_id='acts.open_act_page' транслируются в open_url + URL."""
    from app.core.chat.tools import ChatTool, register_tools

    async def fake_translator(params):
        km = params.get("km_number")
        return {
            "action": "open_url",
            "params": {"url": f"/constructor?act_id=for-{km}"},
        }

    register_tools([ChatTool(
        name="acts.open_act_page",
        domain="acts",
        description="test",
        button_translator=fake_translator,
    )])

    backend_buttons = [
        {"action_id": "acts.open_act_page", "label": "Открыть КМ-11-11111",
         "params": {"km_number": "КМ-11-11111"}},
        {"action_id": "acts.open_act_page", "label": "Открыть КМ-22-22222",
         "params": {"km_number": "КМ-22-22222"}},
    ]
    events, _ = await _run_forward_and_collect_events(
        monkeypatch,
        response_blocks=[{"type": "buttons", "buttons": backend_buttons}],
    )

    buttons_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: buttons")
    ]
    assert len(buttons_events) == 1
    blob = buttons_events[0]
    # action_id'ы переписаны на open_url
    assert "open_url" in blob
    assert "acts.open_act_page" not in blob
    # URL'ы из транслятора присутствуют
    assert "for-КМ-11-11111" in blob
    assert "for-КМ-22-22222" in blob
    # Лейблы сохранены
    assert "Открыть КМ-11-11111" in blob
    assert "Открыть КМ-22-22222" in blob


async def test_orchestrator_passes_through_buttons_with_client_action_ids(
    monkeypatch,
):
    """Кнопки с action_id='open_url' (клиентский action) проходят без изменений."""
    buttons = [
        {"action_id": "open_url", "label": "Открыть",
         "params": {"url": "/some-page"}},
    ]
    events, _ = await _run_forward_and_collect_events(
        monkeypatch,
        response_blocks=[{"type": "buttons", "buttons": buttons}],
    )
    buttons_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: buttons")
    ]
    assert len(buttons_events) == 1
    assert "open_url" in buttons_events[0]
    assert "/some-page" in buttons_events[0]
    assert "Открыть" in buttons_events[0]


async def test_orchestrator_logs_warning_for_unknown_button_action_id(
    monkeypatch, caplog,
):
    """Кнопки с action_id вида '<tool>' без транслятора пропускаются + WARNING."""
    from app.core.chat.tools import ChatTool, register_tools

    # Регистрируем tool БЕЗ button_translator
    register_tools([ChatTool(
        name="unknown.foo",
        domain="unknown",
        description="test",
    )])

    buttons = [
        {"action_id": "unknown.foo", "label": "X", "params": {}},
    ]
    import logging as _logging
    caplog.set_level(_logging.WARNING)
    events, _ = await _run_forward_and_collect_events(
        monkeypatch,
        response_blocks=[{"type": "buttons", "buttons": buttons}],
    )
    buttons_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: buttons")
    ]
    assert len(buttons_events) == 1
    # Кнопка проходит без изменений
    assert "unknown.foo" in buttons_events[0]
    # WARNING был залогирован
    assert any(
        "unknown.foo" in r.getMessage() and "button_translator" in r.getMessage()
        for r in caplog.records
    )


async def test_file_block_emits_block_complete_with_full_payload(monkeypatch):
    """Файл от агента приходит как одно event:block_complete с полным блоком.

    Регрессия: раньше file-блок отправлялся пустой парой block_start+block_end,
    из-за чего фронт ничего не рендерил до перезагрузки истории.
    """
    file_block = {
        "type": "file",
        "file_id": "f-1",
        "filename": "отчёт.pdf",
        "mime_type": "application/pdf",
        "file_size": 1024,
    }
    events, _ = await _run_forward_and_collect_events(
        monkeypatch,
        response_blocks=[file_block],
    )

    complete_events = [
        e for e in events
        if isinstance(e, str) and e.startswith("event: block_complete")
    ]
    assert len(complete_events) == 1
    payload = complete_events[0]
    assert '"type": "file"' in payload
    assert "отчёт.pdf" in payload
    assert "f-1" in payload

    # Никаких block_start/end для типа file — иначе фронт зарендерил бы
    # пустой text-блок (createStreamingBlock не знает type=file).
    assert not any(
        isinstance(e, str)
        and "block_start" in e and '"type": "file"' in e
        for e in events
    )
