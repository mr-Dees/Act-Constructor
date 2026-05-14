"""Тесты адаптера GigaChat-proxy (native functions[] ↔ OpenAI tools[])."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from openai.types.chat import ChatCompletion

from app.domains.chat.services.gigachat_adapter import (
    GigaChatAdapterClient,
    _tools_to_functions,
    _translate_messages,
)


def _make_completion(
    *,
    content: str | None = None,
    function_call: dict | None = None,
    finish_reason: str = "stop",
    usage: dict | None = None,
) -> ChatCompletion:
    """Сборка openai.types.chat.ChatCompletion для тестов."""
    msg: dict = {"role": "assistant", "content": content}
    if function_call is not None:
        msg["function_call"] = function_call
    payload = {
        "id": "cmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": "GigaChat-3-Ultra",
        "choices": [{
            "index": 0,
            "message": msg,
            "finish_reason": finish_reason,
        }],
    }
    if usage is not None:
        payload["usage"] = usage
    return ChatCompletion.model_validate(payload)


def test_adapter_exposes_chat_completions_create():
    """Адаптер должен дакать AsyncOpenAI: .chat.completions.create."""
    adapter = GigaChatAdapterClient(
        base_url="http://liveaccess/v1/gc",
        api_key="t",
        default_headers={},
        timeout=60.0,
    )
    assert hasattr(adapter, "chat")
    assert hasattr(adapter.chat, "completions")
    assert callable(adapter.chat.completions.create)


def test_tools_to_functions_flattens_openai_format():
    """[{type,function:{name,desc,params}}] -> [{name,desc,params}]"""
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Погода",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "open_url",
                "description": "Открыть URL",
                "parameters": {
                    "type": "object",
                    "properties": {"url": {"type": "string"}},
                    "required": ["url"],
                },
            },
        },
    ]
    out = _tools_to_functions(tools)
    assert out == [
        {
            "name": "get_weather",
            "description": "Погода",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "open_url",
            "description": "Открыть URL",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    ]


def test_tools_to_functions_empty_list_returns_empty():
    assert _tools_to_functions([]) == []


def test_tools_to_functions_rejects_non_function_type():
    """Любой type != 'function' — ValueError."""
    with pytest.raises(ValueError, match="ожидался type=function"):
        _tools_to_functions([{"type": "code_interpreter", "function": {"name": "x"}}])


def test_tools_to_functions_rejects_missing_function_key():
    with pytest.raises(ValueError, match="отсутствует поле function"):
        _tools_to_functions([{"type": "function"}])


def test_translate_messages_passthrough_user_and_system():
    """User и system сообщения не трогаются."""
    messages = [
        {"role": "system", "content": "Ты ассистент."},
        {"role": "user", "content": "Привет"},
    ]
    assert _translate_messages(messages) == messages


def test_translate_messages_assistant_tool_calls_to_function_call():
    """Assistant с tool_calls конвертируется в function_call (берётся первый)."""
    messages = [
        {"role": "user", "content": "Открой главную"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {
                    "name": "open_url",
                    "arguments": '{"url":"https://x.com"}',
                },
            }],
        },
    ]
    out = _translate_messages(messages)
    assert out[1] == {
        "role": "assistant",
        "content": None,
        "function_call": {
            "name": "open_url",
            "arguments": '{"url":"https://x.com"}',
        },
    }
    assert "tool_calls" not in out[1]


def test_translate_messages_tool_role_to_function_role():
    """Сообщение role=tool становится role=function с name из mapping."""
    messages = [
        {"role": "user", "content": "?"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [{
                "id": "call_1",
                "type": "function",
                "function": {"name": "open_url", "arguments": "{}"},
            }],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": "ok"},
    ]
    out = _translate_messages(messages)
    assert out[2] == {
        "role": "function",
        "name": "open_url",
        "content": "ok",
    }


def test_translate_messages_unmapped_tool_call_id_uses_unknown_name(caplog):
    """Tool без mapping'а получает name='unknown_function' и warning в лог."""
    messages = [
        {"role": "tool", "tool_call_id": "ghost", "content": "result"},
    ]
    with caplog.at_level("WARNING"):
        out = _translate_messages(messages)
    assert out[0]["role"] == "function"
    assert out[0]["name"] == "unknown_function"
    assert any("ghost" in rec.message for rec in caplog.records)


def test_translate_messages_multiple_tool_calls_takes_first_with_warning(caplog):
    """Если в одном assistant >1 tool_calls — берём первый, остальные в warning."""
    messages = [
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {"id": "c1", "type": "function",
                 "function": {"name": "a", "arguments": "{}"}},
                {"id": "c2", "type": "function",
                 "function": {"name": "b", "arguments": "{}"}},
            ],
        },
    ]
    with caplog.at_level("WARNING"):
        out = _translate_messages(messages)
    assert out[0]["function_call"]["name"] == "a"
    assert any("параллельных" in rec.message.lower() for rec in caplog.records)


def test_translate_messages_assistant_pydantic_object_converts():
    """Если в истории прилетел pydantic-объект (как от openai SDK), он сериализуется."""
    from openai.types.chat import ChatCompletionMessage
    from openai.types.chat.chat_completion_message_tool_call import (
        ChatCompletionMessageToolCall, Function,
    )
    msg = ChatCompletionMessage(
        role="assistant",
        content=None,
        tool_calls=[ChatCompletionMessageToolCall(
            id="call_1", type="function",
            function=Function(name="open_url", arguments="{}"),
        )],
    )
    out = _translate_messages([msg])
    assert out[0]["function_call"]["name"] == "open_url"
