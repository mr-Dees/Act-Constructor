"""Фабрика AsyncOpenAI-клиента по профильным настройкам.

Единственная точка в коде, где смотрят на профиль провайдера —
для подстановки заголовков OpenRouter, если не заданы явно.
Бизнес-логика оркестратора одинакова для всех профилей.
"""
from __future__ import annotations

import logging

from openai import AsyncOpenAI

from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.services.llm_client")


def build_llm_client(settings: ChatDomainSettings) -> AsyncOpenAI:
    """Создаёт AsyncOpenAI-клиента из настроек чат-домена."""
    headers = dict(settings.extra_headers)
    logger.debug(
        "LLM клиент собран: профиль=%s, base_url=%s, model=%s, timeout=%s",
        settings.profile, settings.api_base, settings.model,
        settings.request_timeout,
    )
    return AsyncOpenAI(
        base_url=settings.api_base,
        api_key=settings.api_key.get_secret_value(),
        default_headers=headers,
        timeout=settings.request_timeout,
    )
