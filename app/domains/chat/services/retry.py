"""Декоратор повторных попыток для transient-ошибок LLM-провайдера.

Сценарии retry (для agent-tests Волны 3 — см. docs/retry-test-scenarios.md):
  - Ретраится: HTTP 408 (Request Timeout), 429 (Rate Limit, если on_429),
    500..599 (server errors, если on_5xx), сетевые ошибки httpx
    (ConnectError, ReadTimeout, WriteTimeout, RemoteProtocolError, PoolTimeout).
  - НЕ ретраится: HTTP 400/401/403/404/422 и прочие 4xx, доменные исключения
    чата (ChatLimitError, ChatFileValidationError, ChatRateLimitError и т.п.),
    любые иные исключения.

Backoff: экспоненциальный с джиттером —
  delay_n = min(backoff_base * 2 ** (n-1) + random.uniform(0, 0.5), 60.0).
"""
from __future__ import annotations

import asyncio
import logging
import random
from functools import wraps
from typing import Any, Callable, TypeVar

import httpx
from openai import APIStatusError, APITimeoutError, APIConnectionError

from app.domains.chat.exceptions import (
    ChatFileValidationError,
    ChatLimitError,
    ChatRateLimitError,
)

logger = logging.getLogger("audit_workstation.chat.retry")

F = TypeVar("F", bound=Callable[..., Any])

# HTTP-коды, ретраящиеся независимо от других флагов.
# 408 Request Timeout — сервер сам говорит, что не уложился, повтор уместен.
_ALWAYS_RETRY_STATUS = frozenset({408})

# Сетевые ошибки httpx, для которых имеет смысл повторить запрос.
_RETRYABLE_NETWORK_EXC: tuple[type[BaseException], ...] = (
    httpx.ConnectError,
    httpx.ReadTimeout,
    httpx.WriteTimeout,
    httpx.RemoteProtocolError,
    httpx.PoolTimeout,
)

# Доменные исключения чата, которые НЕ должны ретраиться — это
# валидационные/бизнес-ошибки, повтор не поможет.
_NEVER_RETRY_EXC: tuple[type[BaseException], ...] = (
    ChatLimitError,
    ChatFileValidationError,
    ChatRateLimitError,
)


def retry_on_transient(
    *,
    on_429: bool,
    on_5xx: bool,
    max_attempts: int,
    backoff_base: float,
) -> Callable[[F], F]:
    """Повторяет async-вызов на transient-ошибках провайдера LLM.

    Какие ошибки повторяются:
      - HTTP 408 (request timeout) — всегда
      - HTTP 429 (rate limit) — если on_429=True
      - HTTP 500..599 (server errors, включая 503 Service Unavailable) —
        если on_5xx=True
      - Сетевые исключения httpx (ConnectError, ReadTimeout, WriteTimeout,
        RemoteProtocolError, PoolTimeout) — всегда
      - openai.APITimeoutError / APIConnectionError — всегда (это обёртки
        над httpx-таймаутами/обрывами соединения)
      - Прочие 4xx (400, 401, 403, 404, 422 и т.п.) — НЕ повторяются;
        это клиентские ошибки, повтор не поможет.
      - Доменные исключения чата (ChatLimitError, ChatFileValidationError,
        ChatRateLimitError) — НЕ повторяются, это бизнес-ошибки.

    Между попытками: exponential backoff с небольшим джиттером,
    delay_n = backoff_base * 2 ** (n-1) + random.uniform(0, 0.5), не больше 60с.
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exc: BaseException | None = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except _NEVER_RETRY_EXC:
                    # Доменные ошибки — пробрасываем без повтора.
                    raise
                except APIStatusError as exc:
                    code = getattr(exc, "status_code", None)
                    transient = _is_status_retryable(code, on_429=on_429, on_5xx=on_5xx)
                    if not transient:
                        raise
                    last_exc = exc
                    reason = f"HTTP {code}"
                except (APITimeoutError, APIConnectionError) as exc:
                    # Обёртки OpenAI SDK над httpx-таймаутами/обрывами.
                    last_exc = exc
                    reason = type(exc).__name__
                except _RETRYABLE_NETWORK_EXC as exc:
                    last_exc = exc
                    reason = type(exc).__name__

                if attempt >= max_attempts:
                    break
                delay = backoff_base * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                delay = min(delay, 60.0)
                logger.warning(
                    "Временная ошибка LLM (%s), попытка %d/%d, пауза %.2fс",
                    reason, attempt, max_attempts, delay,
                )
                await asyncio.sleep(delay)
            assert last_exc is not None
            raise last_exc
        return wrapper  # type: ignore[return-value]
    return decorator


def _is_status_retryable(
    code: int | None,
    *,
    on_429: bool,
    on_5xx: bool,
) -> bool:
    """Решает, является ли HTTP-статус повторяемым."""
    if code is None:
        return False
    if code in _ALWAYS_RETRY_STATUS:
        return True
    if code == 429:
        return on_429
    if 500 <= code < 600:
        # Включает 503 Service Unavailable, 502 Bad Gateway, 504 Gateway Timeout
        # и прочие server errors.
        return on_5xx
    return False
