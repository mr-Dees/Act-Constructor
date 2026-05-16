"""Декоратор повторных попыток для transient-ошибок LLM-провайдера."""
from __future__ import annotations

import asyncio
import logging
import random
from functools import wraps
from typing import Any, Callable, TypeVar

from openai import APIStatusError

logger = logging.getLogger("audit_workstation.chat.retry")

F = TypeVar("F", bound=Callable[..., Any])


def retry_on_transient(
    *,
    on_429: bool,
    on_5xx: bool,
    max_attempts: int,
    backoff_base: float,
) -> Callable[[F], F]:
    """Повторяет async-вызов на transient-ошибках провайдера LLM.

    Какие ошибки повторяются:
      - HTTP 429 (rate limit) — если on_429=True
      - HTTP 500..599 (server errors) — если on_5xx=True
      - Прочие 4xx (400, 401, 403, 404, 422 и т.п.) — НЕ повторяются;
        это клиентские ошибки, повтор не поможет.

    Между попытками: exponential backoff с небольшим джиттером,
    delay_n = backoff_base * 2 ** (n-1) + random.uniform(0, 0.5), не больше 60с.
    """
    def decorator(func: F) -> F:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            last_exc: APIStatusError | None = None
            for attempt in range(1, max_attempts + 1):
                try:
                    return await func(*args, **kwargs)
                except APIStatusError as exc:
                    code = getattr(exc, "status_code", None)
                    is_429 = (code == 429)
                    is_5xx = (code is not None and 500 <= code < 600)
                    transient = (is_429 and on_429) or (is_5xx and on_5xx)
                    if not transient:
                        raise
                    last_exc = exc
                    if attempt >= max_attempts:
                        break
                    delay = backoff_base * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                    delay = min(delay, 60.0)
                    logger.warning(
                        "Временная ошибка LLM %s, попытка %d/%d, пауза %.2fс",
                        code, attempt, max_attempts, delay,
                    )
                    await asyncio.sleep(delay)
            assert last_exc is not None
            raise last_exc
        return wrapper  # type: ignore[return-value]
    return decorator
