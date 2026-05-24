"""LLM-вызов с поддержкой circuit-breaker и fallback-провайдера.

Логика жила в ``Orchestrator._llm_call_with_fallback`` (~70 строк). Вынесена
сюда отдельной свободной async-функцией, принимающей ссылку на оркестратор:
все зависимости (circuit-breaker, retry, completions_create, has_fallback,
get_fallback_client, adjust_kwargs_for_fallback) — методы класса
``Orchestrator``, которые тесты могут патчить через ``patch.object`` / instance
assign. Pure-функция зовёт их через ``orch.``, поэтому существующие mock'и
продолжают работать.

Контракт идентичен прежнему методу:
    result = await call_llm_with_fallback(
        orch, client, force_non_streaming=False, **kwargs,
    )
Возвращает ``(result, fallback_used, active_client)``.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.domains.chat.services.orchestrator import Orchestrator

logger = logging.getLogger("audit_workstation.domains.chat.llm_call")


async def call_llm_with_fallback(
    orch: "Orchestrator",
    client,
    *,
    force_non_streaming: bool = False,
    **kwargs,
) -> tuple[Any, bool, Any]:
    """Вызывает LLM с поддержкой fallback при сбое primary.

    Возвращает кортеж ``(result, fallback_used, active_client)``, где
    ``active_client`` — клиент, через который реально прошёл вызов
    (primary либо fallback). При успешном primary fallback_used=False.

    Логика:
      1. Если circuit-breaker open (и fallback есть) — сразу fallback.
      2. Иначе пробуем primary. На provider-failure инкрементим
         счётчик breaker'а; если fallback настроен — пробуем fallback.
         4xx (auth/validation/etc.) пробрасываем без fallback.
      3. На успехе primary — record_success.

    ``force_non_streaming`` — если True и fallback=gigachat, перед
    вызовом fallback'а удаляется stream=True из kwargs.
    """
    breaker = orch._get_circuit_breaker()
    has_fallback = orch._has_fallback()

    # Если circuit разомкнут — primary даже не дёргаем (fast-path)
    if has_fallback and await breaker.is_open():
        fb_client = orch._get_fallback_client()
        if fb_client is not None:
            fb_kwargs = orch._adjust_kwargs_for_fallback(
                kwargs, force_non_streaming=force_non_streaming,
            )
            logger.warning(
                "Circuit breaker open — вызов идёт через fallback "
                "(profile=%s)",
                orch.settings.fallback_profile,
            )
            result = await orch._completions_create(fb_client, **fb_kwargs)
            return result, True, fb_client

    try:
        result = await orch._completions_create(client, **kwargs)
    except Exception as exc:
        if not orch._is_provider_failure(exc):
            # Клиентская ошибка / NotFound / 4xx — fallback не помогает
            raise
        await breaker.record_failure(exc)
        if not has_fallback:
            raise
        fb_client = orch._get_fallback_client()
        if fb_client is None:
            raise
        fb_kwargs = orch._adjust_kwargs_for_fallback(
            kwargs, force_non_streaming=force_non_streaming,
        )
        logger.warning(
            "Primary LLM упал (%s); fallback на profile=%s",
            type(exc).__name__, orch.settings.fallback_profile,
        )
        result = await orch._completions_create(fb_client, **fb_kwargs)
        return result, True, fb_client

    await breaker.record_success()
    return result, False, client
