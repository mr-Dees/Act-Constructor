"""Тесты фабрики LLM-клиента."""
from pydantic import SecretStr

from app.domains.chat.services.llm_client import build_llm_client
from app.domains.chat.settings import ChatDomainSettings


def _settings(**overrides) -> ChatDomainSettings:
    base = dict(
        profile="sglang",
        api_base="http://localhost:30000/v1",
        api_key=SecretStr("dummy"),
        model="m",
        extra_headers={},
    )
    base.update(overrides)
    return ChatDomainSettings(**base)


def test_client_uses_api_base_from_settings():
    s = _settings(
        api_base="https://openrouter.ai/api/v1",
        profile="openrouter",
        api_key=SecretStr("sk-or-x"),
    )
    client = build_llm_client(s)
    assert str(client.base_url).startswith("https://openrouter.ai/api/v1")


def test_extra_headers_propagated():
    s = _settings(
        profile="openrouter",
        extra_headers={"HTTP-Referer": "https://aw.local", "X-Title": "AW"},
    )
    client = build_llm_client(s)
    headers = dict(client.default_headers)
    assert headers.get("HTTP-Referer") == "https://aw.local"
    assert headers.get("X-Title") == "AW"


def test_request_timeout_propagated():
    s = _settings(request_timeout=42)
    client = build_llm_client(s)
    # AsyncOpenAI хранит timeout в нескольких внутренних полях; на верхнем
    # уровне он доступен через атрибут .timeout
    assert client.timeout == 42


def test_gigachat_profile_returns_adapter():
    """Для profile=gigachat фабрика отдаёт GigaChatAdapterClient."""
    from app.domains.chat.services.gigachat_adapter import GigaChatAdapterClient

    s = _settings(
        profile="gigachat",
        api_base="http://liveaccess/v1/gc",
        api_key=SecretStr("internal-token"),
        model="GigaChat-3-Ultra",
    )
    client = build_llm_client(s)
    assert isinstance(client, GigaChatAdapterClient)
    assert str(client.base_url).startswith("http://liveaccess/v1/gc")


def test_non_gigachat_profile_returns_asyncopenai():
    """Для остальных профилей — обычный AsyncOpenAI."""
    from openai import AsyncOpenAI

    for profile in ("openrouter", "sglang", "openai"):
        s = _settings(profile=profile)
        client = build_llm_client(s)
        assert isinstance(client, AsyncOpenAI), \
            f"profile={profile} должен возвращать AsyncOpenAI"
