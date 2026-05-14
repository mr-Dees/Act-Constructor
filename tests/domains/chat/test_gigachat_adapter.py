"""Тесты адаптера GigaChat-proxy (native functions[] ↔ OpenAI tools[])."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from openai.types.chat import ChatCompletion

from app.domains.chat.services.gigachat_adapter import (
    GigaChatAdapterClient,
    _tools_to_functions,
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
