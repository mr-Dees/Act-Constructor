"""Адаптер OpenAI ↔ native GigaChat REST.

GigaChat-proxy частично OpenAI-совместим:
- Streaming не поддерживается (422 EventException).
- Tools передаются как плоский `functions=[{name,description,parameters}]`,
  без OpenAI-обёртки `{type:"function", function:{...}}`.
- Ответ содержит `message.function_call: {name, arguments}` (singular),
  где arguments — dict, а не JSON-строка.

Адаптер скрывает эту разницу: внешне ведёт себя как AsyncOpenAI,
внутри переводит формат запроса/ответа на лету.
"""
from __future__ import annotations

import logging
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(
    "audit_workstation.domains.chat.services.gigachat_adapter",
)


class _Completions:
    """Прокси над `AsyncOpenAI.chat.completions`, переводящий формат."""

    def __init__(self, underlying: AsyncOpenAI) -> None:
        self._underlying = underlying

    async def create(self, **kwargs: Any):
        # На этой задаче — простой проброс. Перевод появится в Task 3+.
        return await self._underlying.chat.completions.create(**kwargs)


class _Chat:
    def __init__(self, underlying: AsyncOpenAI) -> None:
        self.completions = _Completions(underlying)


class GigaChatAdapterClient:
    """Duck-typed обёртка над AsyncOpenAI для GigaChat-proxy."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        default_headers: dict[str, str] | None = None,
        timeout: float | int = 60.0,
    ) -> None:
        self._underlying = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            default_headers=dict(default_headers or {}),
            timeout=timeout,
        )
        self.chat = _Chat(self._underlying)

    @property
    def base_url(self):
        """Проксируем base_url, чтобы тесты могли его проверять."""
        return self._underlying.base_url
