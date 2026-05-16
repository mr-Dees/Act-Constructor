"""E2E-тест: оркестратор с профилем gigachat.

Проверяем сквозной сценарий: настройки ``profile=gigachat`` → фабрика
возвращает ``GigaChatAdapterClient`` → оркестратор форсирует
non-streaming → underlying ``AsyncOpenAI`` получает native
``extra_body.functions`` (а не ``tools``) и возвращает ``function_call`` →
ответ доходит до клиента в виде сохранённого ассистент-сообщения.

Полноценный HTTP-стек не нужен — тестируем end-to-end оркестратор +
адаптер с подменённым underlying client.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import SecretStr

from app.core.chat import tools as tools_registry
from app.core.chat.tools import ChatTool, ChatToolParam
from app.core.domain_registry import reset_registry
from app.domains.chat.services.gigachat_adapter import GigaChatAdapterClient
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _clean_registries():
    """Сброс реестров между тестами (tools + domains)."""
    tools_registry.reset()
    reset_registry()
    yield
    tools_registry.reset()
    reset_registry()


def _make_function_call_response(name: str, arguments: dict):
    """ChatCompletion с GigaChat-style function_call (dict args).

    Адаптер ``_translate_response`` синтезирует tool_calls[] и переводит
    finish_reason в ``tool_calls``.
    """
    from openai.types.chat import ChatCompletion

    payload = {
        "id": "cmpl-1",
        "object": "chat.completion",
        "created": 0,
        "model": "GigaChat-3-Ultra",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "",
                # placeholder-строка для валидации схемы; ниже подменим dict'ом
                "function_call": {"name": name, "arguments": ""},
            },
            "finish_reason": "function_call",
        }],
    }
    completion = ChatCompletion.model_validate(payload)
    # GigaChat возвращает arguments как dict — эмулируем именно это,
    # адаптер должен сам сериализовать его в JSON-строку.
    completion.choices[0].message.function_call.arguments = arguments
    return completion


def _make_text_response(text: str):
    from openai.types.chat import ChatCompletion

    return ChatCompletion.model_validate({
        "id": "cmpl-2",
        "object": "chat.completion",
        "created": 0,
        "model": "GigaChat-3-Ultra",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
    })


@pytest.mark.asyncio
async def test_gigachat_orchestrator_executes_tool_round():
    """End-to-end: оркестратор делает 1 tool-round и финализирует ответ."""
    settings = ChatDomainSettings(
        profile="gigachat",
        api_base="http://liveaccess/v1/gc",
        api_key=SecretStr("t"),
        model="GigaChat-3-Ultra",
        streaming_enabled=True,  # будет проигнорирован для gigachat
        max_tool_rounds=2,
    )

    msg_service = MagicMock()
    msg_service.get_history = AsyncMock(return_value=[])
    conv_service = MagicMock()
    save_calls: list[dict] = []

    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    # Перехватываем сохранение ассистент-сообщения (orchestrator вызывает
    # его через self._save_assistant_message — instance-assignment работает).
    async def fake_save(*, conversation_id, content_blocks, token_usage):
        save_calls.append({
            "conv": conversation_id,
            "blocks": content_blocks,
            "usage": token_usage,
        })
    orch._save_assistant_message = fake_save  # type: ignore[assignment]

    # Регистрируем простой тестовый tool open_url.
    async def _open_url_handler(**kwargs):
        return f"OK: {kwargs.get('url')}"

    tools_registry.register_tools([
        ChatTool(
            domain="chat",
            name="open_url",
            description="Открыть URL",
            parameters=[ChatToolParam(
                name="url", type="string",
                description="URL", required=True,
            )],
            handler=_open_url_handler,
        ),
    ])

    # Подменяем underlying AsyncOpenAI у адаптера на mock-цепочку:
    # 1-й вызов — function_call(open_url, {url: ...}),
    # 2-й вызов — финальный текст.
    fake_responses = [
        _make_function_call_response("open_url", {"url": "https://example.com"}),
        _make_text_response("Открыл ссылку."),
    ]
    fake_create = AsyncMock(side_effect=fake_responses)

    adapter = GigaChatAdapterClient(
        base_url="http://x", api_key="t",
        default_headers={}, timeout=10,
    )
    adapter._underlying.chat.completions.create = fake_create  # type: ignore[assignment]

    with patch(
        "app.domains.chat.services.orchestrator.build_llm_client",
        return_value=adapter,
    ):
        chunks: list[str] = []
        async for chunk in orch.run_stream(
            conversation_id="conv-1",
            user_message="Открой example.com",
            domains=["chat"],
        ):
            chunks.append(chunk)

    # 1) Никакого stream=True не должно было дойти до underlying client
    #    (оркестратор форсирует non-streaming для gigachat).
    assert fake_create.await_count == 2
    for call in fake_create.await_args_list:
        assert call.kwargs.get("stream", False) is False

    # 2) В первый запрос ушли functions[] в extra_body (а не tools[]).
    first_kwargs = fake_create.await_args_list[0].kwargs
    assert "tools" not in first_kwargs
    assert "functions" in first_kwargs.get("extra_body", {})
    fn_names = [f["name"] for f in first_kwargs["extra_body"]["functions"]]
    assert "open_url" in fn_names

    # 3) Ассистент-сообщение сохранилось ровно один раз.
    assert len(save_calls) == 1

    # 4) Финальный текст попал в content_blocks.
    text_blocks = [
        b for b in save_calls[0]["blocks"] if b.get("type") == "text"
    ]
    assert any("Открыл" in b.get("content", "") for b in text_blocks)
