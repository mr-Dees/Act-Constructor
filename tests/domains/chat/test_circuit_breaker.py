"""Тесты circuit breaker для LLM primary-провайдера."""
from __future__ import annotations

import pytest

from app.domains.chat.services.circuit_breaker import (
    STATE_CLOSED,
    STATE_HALF_OPEN,
    STATE_OPEN,
    CircuitBreaker,
    get_breaker,
    reset_breaker,
)


class FakeClock:
    """Управляемый источник monotonic-времени для тестов."""

    def __init__(self, start: float = 0.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Singleton breaker не должен протекать между тестами."""
    reset_breaker()
    yield
    reset_breaker()


def _make_breaker(
    *,
    failure_threshold: int = 3,
    recovery_timeout_sec: int = 30,
    external_recovery: bool = False,
    clock: FakeClock | None = None,
) -> tuple[CircuitBreaker, FakeClock]:
    clk = clock or FakeClock()
    cb = CircuitBreaker(
        failure_threshold=failure_threshold,
        recovery_timeout_sec=recovery_timeout_sec,
        external_recovery=external_recovery,
        clock=clk,
    )
    return cb, clk


# ---------------------------------------------------------------------------
# Базовые состояния
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_closed_state_passes_calls():
    """В начальном состоянии circuit замкнут, вызовы пропускаются."""
    cb, _ = _make_breaker()
    assert cb.state == STATE_CLOSED
    assert await cb.is_open() is False


@pytest.mark.asyncio
async def test_threshold_failures_open_circuit():
    """N подряд record_failure размыкают circuit."""
    cb, _ = _make_breaker(failure_threshold=3)
    for _ in range(2):
        await cb.record_failure(RuntimeError("boom"))
    assert cb.state == STATE_CLOSED
    assert await cb.is_open() is False

    await cb.record_failure(RuntimeError("boom"))
    assert cb.state == STATE_OPEN
    assert await cb.is_open() is True


@pytest.mark.asyncio
async def test_success_resets_failure_counter_in_closed():
    """В closed успех обнуляет счётчик подряд-ошибок."""
    cb, _ = _make_breaker(failure_threshold=3)
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.failure_count == 2
    await cb.record_success()
    assert cb.failure_count == 0
    # И следующих 2 ошибок не хватит — нужно три подряд
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_CLOSED


# ---------------------------------------------------------------------------
# open → half_open по таймауту
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_open_after_timeout_transitions_to_half_open():
    """is_open() после recovery_timeout переводит в half_open."""
    cb, clock = _make_breaker(failure_threshold=2, recovery_timeout_sec=30)
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN

    # Не истёк таймаут — ещё open
    clock.advance(29)
    assert await cb.is_open() is True
    assert cb.state == STATE_OPEN

    # Истёк — half_open, probe разрешён
    clock.advance(2)  # 31
    assert await cb.is_open() is False
    assert cb.state == STATE_HALF_OPEN


@pytest.mark.asyncio
async def test_half_open_success_closes_circuit():
    """В half_open успех probe-вызова закрывает circuit."""
    cb, clock = _make_breaker(failure_threshold=2, recovery_timeout_sec=10)
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    clock.advance(11)
    assert await cb.is_open() is False  # half_open
    assert cb.state == STATE_HALF_OPEN

    await cb.record_success()
    assert cb.state == STATE_CLOSED
    assert cb.failure_count == 0


@pytest.mark.asyncio
async def test_half_open_failure_reopens_circuit():
    """В half_open неудача probe возвращает в open с новым таймаутом."""
    cb, clock = _make_breaker(failure_threshold=2, recovery_timeout_sec=10)
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    clock.advance(11)
    assert await cb.is_open() is False  # half_open
    assert cb.state == STATE_HALF_OPEN

    await cb.record_failure(RuntimeError("probe failed"))
    assert cb.state == STATE_OPEN
    # Окно таймаута начинается заново
    clock.advance(9)
    assert await cb.is_open() is True
    clock.advance(2)  # 11с от reopen
    assert await cb.is_open() is False  # half_open снова


# ---------------------------------------------------------------------------
# Внешнее восстановление (external_recovery)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_recovery_no_auto_half_open_after_timeout():
    """С external_recovery=True is_open() остаётся True после таймаута.

    Таймерного перехода open → half_open нет — восстановлением
    занимается фоновый probe.
    """
    cb, clock = _make_breaker(
        failure_threshold=2, recovery_timeout_sec=30, external_recovery=True
    )
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN

    # Истёк recovery_timeout — но автоперехода нет, всё ещё open
    clock.advance(100)
    assert await cb.is_open() is True
    assert cb.state == STATE_OPEN


@pytest.mark.asyncio
async def test_external_recovery_false_keeps_auto_half_open():
    """Контраст: с external_recovery=False после таймаута → half_open."""
    cb, clock = _make_breaker(
        failure_threshold=2, recovery_timeout_sec=30, external_recovery=False
    )
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN

    clock.advance(31)
    assert await cb.is_open() is False
    assert cb.state == STATE_HALF_OPEN


@pytest.mark.asyncio
async def test_probe_succeeded_from_open_closes_circuit():
    """probe_succeeded() из open закрывает circuit."""
    cb, _ = _make_breaker(
        failure_threshold=2, recovery_timeout_sec=30, external_recovery=True
    )
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN

    await cb.probe_succeeded()
    assert cb.state == STATE_CLOSED
    assert cb.failure_count == 0
    assert await cb.is_open() is False


@pytest.mark.asyncio
async def test_probe_failed_from_open_stays_open():
    """probe_failed() из open оставляет open, обновляя opened_at."""
    cb, clock = _make_breaker(
        failure_threshold=2, recovery_timeout_sec=30, external_recovery=True
    )
    await cb.record_failure(RuntimeError("x"))
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN
    opened_at_before = cb._opened_at

    clock.advance(50)
    await cb.probe_failed()
    assert cb.state == STATE_OPEN
    assert await cb.is_open() is True
    # opened_at обновился на текущее время clock
    assert cb._opened_at == clock.t
    assert cb._opened_at != opened_at_before


@pytest.mark.asyncio
async def test_default_threshold_opens_after_two_failures():
    """Порог по умолчанию (threshold=2) размыкает circuit за 2 сбоя."""
    cb, _ = _make_breaker(failure_threshold=2)
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_CLOSED
    await cb.record_failure(RuntimeError("x"))
    assert cb.state == STATE_OPEN


# ---------------------------------------------------------------------------
# 4xx не считается сбоем
# ---------------------------------------------------------------------------


def test_4xx_does_not_count_as_failure_via_provider_check():
    """Provider-failure-чек оркестратора не считает 4xx сбоем primary.

    CircuitBreaker сам не различает 4xx — он принимает любой exc от
    вызывающего. Эту логику держит оркестратор (_is_provider_failure).
    Здесь проверяем именно её — что 4xx-APIStatusError не помечается
    как provider failure.
    """
    from httpx import Request, Response
    from openai import APIStatusError

    from app.domains.chat.services.orchestrator import Orchestrator

    req = Request("POST", "http://x")
    for code in (400, 401, 403, 404, 422, 429):
        exc = APIStatusError(
            message="x", response=Response(code, request=req), body=None,
        )
        assert Orchestrator._is_provider_failure(exc) is False, (
            f"4xx ({code}) не должен считаться сбоем provider'а"
        )


def test_5xx_counts_as_provider_failure():
    from httpx import Request, Response
    from openai import APIStatusError

    from app.domains.chat.services.orchestrator import Orchestrator

    req = Request("POST", "http://x")
    for code in (500, 502, 503, 504):
        exc = APIStatusError(
            message="x", response=Response(code, request=req), body=None,
        )
        assert Orchestrator._is_provider_failure(exc) is True


def test_transport_and_timeout_count_as_provider_failure():
    import asyncio

    import httpx
    from openai import APIConnectionError, APITimeoutError

    from app.domains.chat.services.orchestrator import Orchestrator

    req = httpx.Request("POST", "http://x")
    assert Orchestrator._is_provider_failure(APITimeoutError(request=req))
    assert Orchestrator._is_provider_failure(APIConnectionError(request=req))
    assert Orchestrator._is_provider_failure(asyncio.TimeoutError())
    assert Orchestrator._is_provider_failure(ValueError("not provider")) is False


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------


def test_get_breaker_returns_singleton():
    a = get_breaker(failure_threshold=5, recovery_timeout_sec=60)
    b = get_breaker(failure_threshold=5, recovery_timeout_sec=60)
    assert a is b


def test_get_breaker_reconfigures_existing():
    """Повторный вызов с другими параметрами не пересоздаёт breaker,
    но обновляет конфигурацию (state сохраняется)."""
    a = get_breaker(failure_threshold=3, recovery_timeout_sec=30)
    b = get_breaker(failure_threshold=10, recovery_timeout_sec=120)
    assert a is b
    assert a._failure_threshold == 10
    assert a._recovery_timeout_sec == 120


def test_reset_breaker_clears_singleton():
    a = get_breaker()
    reset_breaker()
    b = get_breaker()
    assert a is not b
