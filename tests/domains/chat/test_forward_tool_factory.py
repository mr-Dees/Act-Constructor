"""Тесты фабрики per-request ChatTool ``chat.forward_to_knowledge_agent``.

Wave 2 разделил регистрацию tool'а (статический descriptor с handler=None,
``per_request_handler=True``) и build per-request с замыканием контекста.
"""
from __future__ import annotations

import re
from unittest.mock import AsyncMock, patch

import pytest

from app.core.chat.names import TOOL_FORWARD_TO_KNOWLEDGE_AGENT
from app.core.chat.tools import ChatTool
from app.domains.chat.integrations.forward_handler import (
    FORWARD_SENTINEL_PATTERN,
)
from app.domains.chat.services.forward_tool_factory import (
    build_forward_tool,
    build_forward_tool_descriptor,
)


def test_build_forward_tool_descriptor_no_handler():
    """Descriptor — handler=None, per_request_handler=True, имя из names.py."""
    tool = build_forward_tool_descriptor()
    assert isinstance(tool, ChatTool)
    assert tool.name == TOOL_FORWARD_TO_KNOWLEDGE_AGENT
    assert tool.handler is None
    assert tool.per_request_handler is True
    assert tool.domain == "chat"
    assert tool.category == "forward"


def test_build_forward_tool_descriptor_parameters():
    """Параметры — question (required) и kb_hint (optional)."""
    tool = build_forward_tool_descriptor()
    param_names = {p.name for p in tool.parameters}
    assert "question" in param_names
    assert "kb_hint" in param_names

    question = next(p for p in tool.parameters if p.name == "question")
    kb_hint = next(p for p in tool.parameters if p.name == "kb_hint")
    assert question.required is True
    assert kb_hint.required is False


def test_build_forward_tool_descriptor_to_openai_schema():
    """to_openai_tool() возвращает валидный function-calling-schema."""
    tool = build_forward_tool_descriptor()
    schema = tool.to_openai_tool()
    assert schema["type"] == "function"
    assert schema["function"]["name"] == TOOL_FORWARD_TO_KNOWLEDGE_AGENT
    props = schema["function"]["parameters"]["properties"]
    assert "question" in props
    assert "kb_hint" in props
    assert "question" in schema["function"]["parameters"]["required"]


async def test_build_forward_tool_with_context_returns_sentinel(mock_conn):
    """Handler делает INSERT в agent_requests и возвращает sentinel-строку."""
    with patch(
        "app.domains.chat.services.forward_tool_factory.AgentBridgeService",
    ) as MockBridge:
        bridge_inst = MockBridge.return_value
        bridge_inst.send = AsyncMock(
            return_value="11111111-2222-3333-4444-555555555555",
        )

        tool = build_forward_tool(
            conn=mock_conn,
            conversation_id="conv-1",
            message_id="msg-1",
            user_id="u",
            domain_name="acts",
            knowledge_bases=["acts_default"],
            history=[{"role": "user", "content": "Привет"}],
            files=[],
        )

        assert tool.handler is not None
        assert tool.name == TOOL_FORWARD_TO_KNOWLEDGE_AGENT
        assert tool.per_request_handler is True

        # Вызов handler'а возвращает sentinel
        result = await tool.handler(question="Что такое акт?")
        assert FORWARD_SENTINEL_PATTERN.match(result) is not None
        # И bridge.send получил параметры
        bridge_inst.send.assert_awaited_once()
        kwargs = bridge_inst.send.await_args.kwargs
        assert kwargs["conversation_id"] == "conv-1"
        assert kwargs["message_id"] == "msg-1"
        assert kwargs["last_user_message"] == "Что такое акт?"


async def test_build_forward_tool_kb_hint_appended(mock_conn):
    """kb_hint, если передан, добавляется в knowledge_bases (без дубля)."""
    with patch(
        "app.domains.chat.services.forward_tool_factory.AgentBridgeService",
    ) as MockBridge:
        bridge_inst = MockBridge.return_value
        bridge_inst.send = AsyncMock(return_value="00000000-0000-0000-0000-000000000000")

        tool = build_forward_tool(
            conn=mock_conn,
            conversation_id="c",
            message_id="m",
            user_id="u",
            domain_name=None,
            knowledge_bases=["base_a"],
            history=[],
            files=[],
        )
        await tool.handler(question="q", kb_hint="base_b")
        kbs = bridge_inst.send.await_args.kwargs["knowledge_bases"]
        assert kbs == ["base_a", "base_b"]

        # Повторный вызов с уже присутствующим hint — без дубля
        bridge_inst.send.reset_mock()
        await tool.handler(question="q", kb_hint="base_a")
        kbs = bridge_inst.send.await_args.kwargs["knowledge_bases"]
        assert kbs == ["base_a"]


async def test_build_forward_tool_sentinel_format(mock_conn):
    """Sentinel содержит request_id, парсится FORWARD_SENTINEL_PATTERN."""
    with patch(
        "app.domains.chat.services.forward_tool_factory.AgentBridgeService",
    ) as MockBridge:
        bridge_inst = MockBridge.return_value
        rid = "abcdef01-2345-4678-9abc-def012345678"
        bridge_inst.send = AsyncMock(return_value=rid)

        tool = build_forward_tool(
            conn=mock_conn,
            conversation_id="c",
            message_id="m",
            user_id="u",
            domain_name=None,
            knowledge_bases=[],
            history=[],
            files=[],
        )
        result = await tool.handler(question="q")
        match = FORWARD_SENTINEL_PATTERN.match(result)
        assert match is not None
        assert match.group("request_id") == rid
