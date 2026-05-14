"""Фабрика AsyncOpenAI-клиента по профильным настройкам.

Единственная точка в коде, где смотрят на профиль провайдера —
для подстановки заголовков OpenRouter, если не заданы явно.
Бизнес-логика оркестратора одинакова для всех профилей.

**Кэш клиентов**: каждый клиент несёт под капотом httpx.AsyncClient
с собственным connection pool. Если создавать клиент per-request,
сокеты копятся (особенно при долгих SSE-сессиях). Чтобы этого избежать,
``build_llm_client`` кэширует клиентов по ключу (profile, api_base,
api_key, headers, timeout); ``close_cached_clients()`` зовётся из
``on_shutdown`` chat-домена и закрывает httpx-клиентов.
"""
from __future__ import annotations

import logging
from typing import Any

from openai import AsyncOpenAI

from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.services.llm_client")

# Ключ кэша: профильно-неизменяемые поля, по которым httpx.AsyncClient
# и connection pool остаются совместимы. Если settings меняются на лету
# (например, в тестах) — будет новый клиент, старый осиротеет, но
# close_cached_clients() закроет всех.
_clients_cache: dict[tuple[Any, ...], Any] = {}


def _make_client(settings: ChatDomainSettings):
    """Создаёт новый LLM-клиент (без кэша)."""
    headers = dict(settings.extra_headers)
    if settings.profile == "gigachat":
        from app.domains.chat.services.gigachat_adapter import (
            GigaChatAdapterClient,
        )
        return GigaChatAdapterClient(
            base_url=settings.api_base,
            api_key=settings.api_key.get_secret_value(),
            default_headers=headers,
            timeout=settings.request_timeout,
        )
    return AsyncOpenAI(
        base_url=settings.api_base,
        api_key=settings.api_key.get_secret_value(),
        default_headers=headers,
        timeout=settings.request_timeout,
    )


def build_llm_client(settings: ChatDomainSettings):
    """Возвращает LLM-клиент из кэша или создаёт нового.

    Один клиент на (profile, api_base, api_key, headers, timeout)
    держится в памяти на всё время жизни процесса; закрывается через
    :func:`close_cached_clients` в on_shutdown.

    Для большинства профилей — AsyncOpenAI.
    Для profile=gigachat — GigaChatAdapterClient, который проксирует
    AsyncOpenAI с переводом форматов tools↔functions (см. gigachat_adapter.py).
    """
    headers_key = tuple(sorted(settings.extra_headers.items()))
    cache_key: tuple[Any, ...] = (
        settings.profile,
        settings.api_base,
        settings.api_key.get_secret_value(),
        headers_key,
        settings.request_timeout,
    )
    client = _clients_cache.get(cache_key)
    if client is not None:
        return client

    client = _make_client(settings)
    _clients_cache[cache_key] = client
    logger.debug(
        "LLM клиент создан: профиль=%s, base_url=%s, model=%s, timeout=%s",
        settings.profile, settings.api_base, settings.model,
        settings.request_timeout,
    )
    return client


async def close_cached_clients() -> int:
    """Закрывает кэшированные LLM-клиенты (httpx.AsyncClient под капотом).

    Возвращает количество закрытых клиентов. Зовётся из on_shutdown
    chat-домена; в тестах можно использовать `_clients_cache.clear()`.
    """
    count = 0
    for client in list(_clients_cache.values()):
        underlying = getattr(client, "_underlying", client)
        close = getattr(underlying, "close", None) or getattr(
            underlying, "aclose", None,
        )
        if close is not None:
            try:
                await close()
                count += 1
            except Exception:
                logger.exception("Не удалось закрыть LLM-клиента")
    _clients_cache.clear()
    if count:
        logger.info("LLM-клиенты закрыты: %d", count)
    return count
