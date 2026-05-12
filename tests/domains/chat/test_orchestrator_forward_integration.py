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

    # Мокируем _save_assistant_message чтобы не лезть в реальную БД
    orch._save_assistant_message = AsyncMock()

    # _handle_forward_call открывает get_db() — подсовываем фиктивное соединение.
    fake_conn = AsyncMock()
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=fake_conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    # AgentBridgeService/репозитории при инициализации зовут get_adapter().
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    events: list[str] = []
    with (
        patch("app.db.connection.get_db", return_value=ctx),
        patch("app.db.repositories.base.get_adapter", return_value=fake_adapter),
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

    # SSE-стрим должен содержать tool_call для forward, затем reasoning-блок,
    # затем финальный text-блок, и message_end.
    text = "\n".join(events)
    assert "chat.forward_to_knowledge_agent" in text
    assert "Думаю" in text  # reasoning
    assert "КСО — это" in text  # финальный ответ
    assert "message_end" in text

    # Финальные блоки агента должны быть переданы в _save_assistant_message
    orch._save_assistant_message.assert_called_once()
    saved_blocks = orch._save_assistant_message.call_args.kwargs["content_blocks"]
    assert saved_blocks == [{"type": "text", "content": "КСО — это ..."}]
