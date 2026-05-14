"""Тесты адаптера GigaChat-proxy (native functions[] ↔ OpenAI tools[])."""
from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from openai.types.chat import ChatCompletion

from app.domains.chat.services.gigachat_adapter import (
    GigaChatAdapterClient,
    _tools_to_functions,
    _translate_messages,
    _translate_response,
)


def _make_completion(
    *,
    content: str | None = None,
    function_call: dict | None = None,
    finish_reason: str = "stop",
    usage: dict | None = None,
) -> ChatCompletion:
    """Сборка openai.types.chat.ChatCompletion для тестов.

    GigaChat возвращает `function_call.arguments` как dict, что нарушает
    OpenAI-схему (там str). Поэтому сначала валидируем payload со
    строковым placeholder'ом, а затем подменяем поле через прямую мутацию
    pydantic-модели — это эмулирует реальный ответ proxy.
    """
    msg: dict = {"role": "assistant", "content": content}
    fc_real_args: Any = None
    if function_call is not None:
        fc_real_args = function_call.get("arguments")
        msg["function_call"] = {
            "name": function_call.get("name", ""),
            # placeholder-строка только для валидации схемы
            "arguments": fc_real_args if isinstance(fc_real_args, str) else "",
        }
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
    completion = ChatCompletion.model_validate(payload)
    # Подменяем arguments на исходный (возможно dict), эмулируя GigaChat.
    if function_call is not None and not isinstance(fc_real_args, str):
        completion.choices[0].message.function_call.arguments = fc_real_args
    return completion


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


def test_translate_response_passthrough_when_no_function_call():
    """Обычный текстовый ответ возвращается без изменений."""
    resp = _make_completion(content="Привет!", finish_reason="stop")
    out = _translate_response(resp)
    assert out.choices[0].message.content == "Привет!"
    assert out.choices[0].finish_reason == "stop"
    assert out.choices[0].message.tool_calls is None


def test_translate_response_dict_args_synthesizes_tool_calls():
    """function_call с dict arguments → tool_calls с JSON-строкой."""
    resp = _make_completion(
        content="",
        function_call={
            "name": "get_weather",
            "arguments": {"city": "Москва"},  # dict, не строка
        },
        finish_reason="function_call",
    )
    out = _translate_response(resp)
    choice = out.choices[0]
    assert choice.finish_reason == "tool_calls"
    tcs = choice.message.tool_calls
    assert tcs is not None and len(tcs) == 1
    assert tcs[0].type == "function"
    assert tcs[0].id.startswith("gc_")
    assert tcs[0].function.name == "get_weather"
    # arguments должны быть JSON-строкой, а не dict
    assert isinstance(tcs[0].function.arguments, str)
    assert json.loads(tcs[0].function.arguments) == {"city": "Москва"}
    # function_call зануляется, чтобы оркестратор смотрел только в tool_calls
    assert choice.message.function_call is None


def test_translate_response_string_args_preserved():
    """function_call с уже-строковыми arguments не теряет формат."""
    resp = _make_completion(
        function_call={
            "name": "open_url",
            "arguments": '{"url": "https://x.com"}',  # строка
        },
        finish_reason="function_call",
    )
    out = _translate_response(resp)
    args = out.choices[0].message.tool_calls[0].function.arguments
    assert isinstance(args, str)
    assert json.loads(args) == {"url": "https://x.com"}


def test_translate_response_non_ascii_args_keep_unicode():
    """Русские символы в arguments не должны эскейпиться в \\u…."""
    resp = _make_completion(
        function_call={"name": "search", "arguments": {"q": "погода"}},
        finish_reason="function_call",
    )
    out = _translate_response(resp)
    args = out.choices[0].message.tool_calls[0].function.arguments
    assert "погода" in args  # ensure_ascii=False


@pytest.mark.asyncio
async def test_create_translates_request_and_response():
    """create() переводит tools→functions, function_call→tool_calls."""
    adapter = GigaChatAdapterClient(
        base_url="http://liveaccess/v1/gc",
        api_key="t",
        default_headers={},
        timeout=60.0,
    )
    # Мокаем underlying AsyncOpenAI: проверяем что в неё ушёл native формат
    fake_resp = _make_completion(
        function_call={"name": "get_weather", "arguments": {"city": "Москва"}},
        finish_reason="function_call",
    )
    with patch.object(
        adapter._underlying.chat.completions, "create",
        new=AsyncMock(return_value=fake_resp),
    ) as mock_create:
        out = await adapter.chat.completions.create(
            model="GigaChat-3-Ultra",
            messages=[{"role": "user", "content": "Погода?"}],
            tools=[{
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "",
                    "parameters": {"type": "object"},
                },
            }],
            temperature=0.1,
        )
    # Что ушло на proxy
    call_kwargs = mock_create.await_args.kwargs
    assert call_kwargs["model"] == "GigaChat-3-Ultra"
    assert "tools" not in call_kwargs
    assert "stream" not in call_kwargs
    assert call_kwargs["extra_body"]["functions"] == [{
        "name": "get_weather",
        "description": "",
        "parameters": {"type": "object"},
    }]
    # Что вернулось в оркестратор
    assert out.choices[0].finish_reason == "tool_calls"
    assert out.choices[0].message.tool_calls[0].function.name == "get_weather"


@pytest.mark.asyncio
async def test_create_strips_stream_true_and_logs_warning(caplog):
    """stream=True игнорируется, лог-warning присутствует."""
    adapter = GigaChatAdapterClient(
        base_url="http://x", api_key="t", default_headers={}, timeout=60.0,
    )
    fake_resp = _make_completion(content="ok")
    with patch.object(
        adapter._underlying.chat.completions, "create",
        new=AsyncMock(return_value=fake_resp),
    ) as mock_create, caplog.at_level("WARNING"):
        await adapter.chat.completions.create(
            model="m",
            messages=[{"role": "user", "content": "x"}],
            stream=True,
        )
    call_kwargs = mock_create.await_args.kwargs
    assert "stream" not in call_kwargs
    assert any("streaming" in rec.message.lower() for rec in caplog.records)


@pytest.mark.asyncio
async def test_create_drops_tool_choice():
    """tool_choice не пробрасывается в native запрос."""
    adapter = GigaChatAdapterClient(
        base_url="http://x", api_key="t", default_headers={}, timeout=60.0,
    )
    fake_resp = _make_completion(content="ok")
    with patch.object(
        adapter._underlying.chat.completions, "create",
        new=AsyncMock(return_value=fake_resp),
    ) as mock_create:
        await adapter.chat.completions.create(
            model="m",
            messages=[{"role": "user", "content": "x"}],
            tool_choice="auto",
        )
    assert "tool_choice" not in mock_create.await_args.kwargs


@pytest.mark.asyncio
async def test_create_passes_temperature_and_model():
    adapter = GigaChatAdapterClient(
        base_url="http://x", api_key="t", default_headers={}, timeout=60.0,
    )
    fake_resp = _make_completion(content="ok")
    with patch.object(
        adapter._underlying.chat.completions, "create",
        new=AsyncMock(return_value=fake_resp),
    ) as mock_create:
        await adapter.chat.completions.create(
            model="GigaChat-3-Ultra",
            messages=[{"role": "user", "content": "x"}],
            temperature=0.42,
        )
    kw = mock_create.await_args.kwargs
    assert kw["model"] == "GigaChat-3-Ultra"
    assert kw["temperature"] == 0.42


@pytest.mark.asyncio
async def test_create_no_tools_no_extra_body():
    """Без tools — extra_body не должен появиться (или пустой)."""
    adapter = GigaChatAdapterClient(
        base_url="http://x", api_key="t", default_headers={}, timeout=60.0,
    )
    fake_resp = _make_completion(content="ok")
    with patch.object(
        adapter._underlying.chat.completions, "create",
        new=AsyncMock(return_value=fake_resp),
    ) as mock_create:
        await adapter.chat.completions.create(
            model="m",
            messages=[{"role": "user", "content": "x"}],
        )
    kw = mock_create.await_args.kwargs
    # extra_body либо отсутствует, либо NOT_GIVEN sentinel из openai
    from openai import NOT_GIVEN
    assert kw.get("extra_body", NOT_GIVEN) in (NOT_GIVEN, None, {}) or \
        "functions" not in (kw.get("extra_body") or {})
