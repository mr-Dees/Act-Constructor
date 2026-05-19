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


# ===== Расширенное покрытие по docs/retry-test-scenarios.md =====

async def test_retries_on_408_always():
    """408 ретраится всегда, независимо от on_429/on_5xx-флагов."""
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise _fake_status_error(408)
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


@pytest.mark.parametrize("code", [500, 502, 503, 504])
async def test_retries_on_5xx_codes(code):
    """500, 502, 503, 504 — все ретраятся при on_5xx=True."""
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise _fake_status_error(code)
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


@pytest.mark.parametrize("code", [400, 401, 403, 404, 422])
async def test_does_not_retry_on_non_retryable_4xx(code):
    """400/401/403/404/422 не ретраятся."""
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        raise _fake_status_error(code)

    with pytest.raises(APIStatusError):
        await fn()
    assert calls["n"] == 1, f"4xx code {code} не должен ретраиться"


@pytest.mark.parametrize("exc_class", [
    "httpx.ConnectError",
    "httpx.ReadTimeout",
    "httpx.WriteTimeout",
    "httpx.PoolTimeout",
    "httpx.RemoteProtocolError",
])
async def test_retries_on_network_errors(exc_class):
    """Сетевые ошибки httpx (ConnectError/ReadTimeout/…) ретраятся."""
    import httpx as _httpx
    module, name = exc_class.split(".")
    exc_cls = getattr(_httpx, name)
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise exc_cls("simulated")
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


async def test_retries_on_openai_api_timeout_error():
    """openai.APITimeoutError — обёртка над httpx.ReadTimeout — ретраится."""
    from openai import APITimeoutError
    import httpx as _httpx
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise APITimeoutError(request=_httpx.Request("POST", "http://x"))
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


async def test_retries_on_openai_api_connection_error():
    """openai.APIConnectionError ретраится."""
    from openai import APIConnectionError
    import httpx as _httpx
    calls = {"n": 0}

    @retry_on_transient(on_429=False, on_5xx=False, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise APIConnectionError(request=_httpx.Request("POST", "http://x"))
        return "ok"

    assert await fn() == "ok"
    assert calls["n"] == 2


async def test_does_not_retry_chat_limit_error():
    """Доменное ChatLimitError — пробрасывается без ретрая."""
    from app.domains.chat.exceptions import ChatLimitError
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=5, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        raise ChatLimitError("превышен лимит")

    with pytest.raises(ChatLimitError):
        await fn()
    assert calls["n"] == 1


async def test_does_not_retry_chat_file_validation_error():
    """Доменное ChatFileValidationError — без ретрая."""
    from app.domains.chat.exceptions import ChatFileValidationError
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=5, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        raise ChatFileValidationError("плохой файл")

    with pytest.raises(ChatFileValidationError):
        await fn()
    assert calls["n"] == 1


async def test_does_not_retry_chat_rate_limit_error():
    """Доменный ChatRateLimitError (per-user) — без ретрая."""
    from app.domains.chat.exceptions import ChatRateLimitError
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=5, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        raise ChatRateLimitError("user limit")

    with pytest.raises(ChatRateLimitError):
        await fn()
    assert calls["n"] == 1


async def test_does_not_retry_arbitrary_value_error():
    """Произвольное ValueError — не ретраится."""
    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        raise ValueError("bad arg")

    with pytest.raises(ValueError):
        await fn()
    assert calls["n"] == 1


async def test_backoff_grows_exponentially(monkeypatch):
    """Между попытками задержка растёт экспоненциально: base*1, base*2, base*4."""
    sleeps: list[float] = []

    async def fake_sleep(sec):
        sleeps.append(sec)

    monkeypatch.setattr("app.domains.chat.services.retry.asyncio.sleep", fake_sleep)
    # Зафиксируем jitter в 0, чтобы тест был детерминированным
    monkeypatch.setattr(
        "app.domains.chat.services.retry.random.uniform",
        lambda a, b: 0.0,
    )

    @retry_on_transient(on_429=True, on_5xx=False, max_attempts=4, backoff_base=1.0)
    async def fn():
        raise _fake_status_error(429)

    with pytest.raises(APIStatusError):
        await fn()

    # 4 попытки → 3 sleep'а между ними: 1*2^0=1, 1*2^1=2, 1*2^2=4
    assert sleeps == [1.0, 2.0, 4.0]


async def test_backoff_capped_at_60_seconds(monkeypatch):
    """Задержка clamped к 60 секундам сверху."""
    sleeps: list[float] = []

    async def fake_sleep(sec):
        sleeps.append(sec)

    monkeypatch.setattr("app.domains.chat.services.retry.asyncio.sleep", fake_sleep)
    monkeypatch.setattr(
        "app.domains.chat.services.retry.random.uniform",
        lambda a, b: 0.0,
    )

    # base=100 → даже первый sleep capped к 60
    @retry_on_transient(on_429=True, on_5xx=False, max_attempts=3, backoff_base=100.0)
    async def fn():
        raise _fake_status_error(429)

    with pytest.raises(APIStatusError):
        await fn()
    assert all(s <= 60.0 + 1e-9 for s in sleeps)
    assert sleeps and max(sleeps) == 60.0


async def test_status_error_with_none_code_does_not_retry():
    """APIStatusError с code=None не ретраится (защитный кейс)."""
    from httpx import Request

    class _NoCodeError(APIStatusError):
        # status_code = None
        pass

    calls = {"n": 0}

    @retry_on_transient(on_429=True, on_5xx=True, max_attempts=3, backoff_base=0.0)
    async def fn():
        calls["n"] += 1
        err = APIStatusError.__new__(APIStatusError)
        # Эмулируем: status_code=None
        err.status_code = None  # type: ignore[attr-defined]
        err.response = None  # type: ignore[attr-defined]
        err.request = Request("POST", "http://x")  # type: ignore[attr-defined]
        err.body = None  # type: ignore[attr-defined]
        raise err

    with pytest.raises(APIStatusError):
        await fn()
    assert calls["n"] == 1
