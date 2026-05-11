"""Тесты retry-декоратора для transient-ошибок LLM."""
import pytest
from openai import APIStatusError

from app.domains.chat.services.retry import retry_on_transient


def _fake_status_error(code: int) -> APIStatusError:
    """Создать фейковую APIStatusError с нужным HTTP-кодом."""
    from httpx import Request, Response
    req = Request("POST", "http://x")
    resp = Response(code, request=req)
    return APIStatusError(message="x", response=resp, body=None)


async def test_retries_on_429_when_enabled():
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 3:
            raise _fake_status_error(429)
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 3


async def test_does_not_retry_on_429_when_disabled():
    @retry_on_transient(on_429=False, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        raise _fake_status_error(429)

    with pytest.raises(APIStatusError):
        await fn()


async def test_retries_on_5xx_when_enabled():
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise _fake_status_error(503)
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


async def test_does_not_retry_on_4xx_other_than_429():
    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        raise _fake_status_error(400)

    with pytest.raises(APIStatusError):
        await fn()


async def test_does_not_retry_on_403():
    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        raise _fake_status_error(403)

    with pytest.raises(APIStatusError):
        await fn()


async def test_max_attempts_exhausted_reraises():
    @retry_on_transient(on_429=True, on_5xx=False, max_attempts=2, backoff_base=0.0)
    async def fn():
        raise _fake_status_error(429)

    with pytest.raises(APIStatusError):
        await fn()


async def test_returns_immediately_when_no_error():
    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        return "fast"

    assert await fn() == "fast"
