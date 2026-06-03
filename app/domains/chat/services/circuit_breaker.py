"""Process-local circuit breaker для LLM primary-провайдера.

Состояния:
    closed   — primary работает, вызовы идут как обычно.
    open     — primary упал N раз подряд; вызовы НЕ идут, fallback берёт всё.
    half_open — после recovery_timeout одна проба primary; успех → closed,
                ошибка → open (с новым отсчётом таймаута).

Singleton на процесс (`get_breaker()`); потокобезопасен через asyncio.Lock.

Параметры (failure_threshold, recovery_timeout_sec) перечитываются из
ChatDomainSettings на каждом обращении к ``is_open()`` — изменения в
настройках во время жизни процесса (например, в тестах) применяются
без рестарта.

4xx-ошибки (auth/rate-limit/bad-request) НЕ должны вызывать
``record_failure()`` — это ответственность вызывающего кода. Сюда
попадают только реальные транспортные/5xx-сбои провайдера.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable

logger = logging.getLogger("audit_workstation.domains.chat.circuit_breaker")

# Состояния circuit breaker'а
STATE_CLOSED = "closed"
STATE_OPEN = "open"
STATE_HALF_OPEN = "half_open"


class CircuitBreaker:
    """Process-local circuit breaker.

    ``clock`` — поставщик monotonic-времени (по умолчанию ``time.monotonic``);
    тестам передаётся FakeClock без реального sleep.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        recovery_timeout_sec: int = 60,
        external_recovery: bool = False,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._failure_threshold = failure_threshold
        self._recovery_timeout_sec = recovery_timeout_sec
        self._external_recovery = external_recovery
        self._clock = clock
        self._state: str = STATE_CLOSED
        self._failure_count: int = 0
        self._opened_at: float | None = None
        self._lock = asyncio.Lock()

    @property
    def state(self) -> str:
        """Текущее состояние без учёта истечения recovery_timeout.

        Для проверки "пропускать ли вызов через primary" используй
        ``is_open()`` — он сам переведёт open → half_open по таймауту.
        """
        return self._state

    @property
    def failure_count(self) -> int:
        return self._failure_count

    def configure(
        self,
        *,
        failure_threshold: int | None = None,
        recovery_timeout_sec: int | None = None,
        external_recovery: bool | None = None,
    ) -> None:
        """Обновляет параметры breaker'а (без сброса состояния)."""
        if failure_threshold is not None:
            self._failure_threshold = failure_threshold
        if recovery_timeout_sec is not None:
            self._recovery_timeout_sec = recovery_timeout_sec
        if external_recovery is not None:
            self._external_recovery = external_recovery

    async def is_open(self) -> bool:
        """Возвращает True если primary НЕЛЬЗЯ вызывать сейчас.

        В состоянии ``open``, если истёк ``recovery_timeout``, переводит
        в ``half_open`` и возвращает False (разрешая probe-вызов).

        Если включён ``external_recovery``, таймерное восстановление
        выключено: в ``open`` всегда возвращается True, а закрывать
        circuit будет фоновый probe через ``probe_succeeded()`` —
        авто-перехода open → half_open по таймеру не происходит.
        """
        async with self._lock:
            if self._state == STATE_OPEN:
                if self._external_recovery:
                    # Восстановлением занимается фоновый probe, не таймер.
                    return True
                if self._opened_at is None:
                    # invariant defensive
                    self._opened_at = self._clock()
                elapsed = self._clock() - self._opened_at
                if elapsed >= self._recovery_timeout_sec:
                    logger.info(
                        "Circuit breaker: open → half_open после %.1fс",
                        elapsed,
                    )
                    self._state = STATE_HALF_OPEN
                    return False
                return True
            return False

    async def record_success(self) -> None:
        """Фиксирует успешный вызов primary.

        В half_open закрывает circuit. В closed сбрасывает счётчик
        подряд-ошибок. В open игнорируется (теоретически не должно
        случаться — is_open() не пропустил бы вызов).
        """
        async with self._lock:
            if self._state == STATE_HALF_OPEN:
                logger.info(
                    "Circuit breaker: half_open → closed (probe успешен)",
                )
                self._state = STATE_CLOSED
                self._failure_count = 0
                self._opened_at = None
            elif self._state == STATE_CLOSED:
                self._failure_count = 0

    async def record_failure(self, exc: BaseException) -> None:
        """Фиксирует сбой primary.

        В half_open сразу возвращает в open (probe не удался).
        В closed инкрементирует счётчик; на пороге размыкает circuit.
        """
        async with self._lock:
            if self._state == STATE_HALF_OPEN:
                logger.warning(
                    "Circuit breaker: half_open → open "
                    "(probe упал: %s)",
                    type(exc).__name__,
                )
                self._state = STATE_OPEN
                self._opened_at = self._clock()
                return

            if self._state == STATE_OPEN:
                # Не должно случаться (is_open() блокирует вызов),
                # но обороняемся: обновляем opened_at, чтобы окно
                # восстановления отсчитывалось от последнего сбоя.
                self._opened_at = self._clock()
                return

            # closed
            self._failure_count += 1
            if self._failure_count >= self._failure_threshold:
                logger.warning(
                    "Circuit breaker: closed → open "
                    "(failures=%d, threshold=%d, last_exc=%s)",
                    self._failure_count,
                    self._failure_threshold,
                    type(exc).__name__,
                )
                self._state = STATE_OPEN
                self._opened_at = self._clock()

    async def probe_succeeded(self) -> None:
        """Фиксирует успешную фоновую пробу primary (внешнее восстановление).

        Из ``open``/``half_open`` закрывает circuit. В ``closed`` — no-op.
        В отличие от ``record_success()`` закрывает circuit и из ``open``
        (таймерного перехода в half_open при external_recovery нет).
        """
        async with self._lock:
            if self._state in (STATE_OPEN, STATE_HALF_OPEN):
                logger.info(
                    "Circuit breaker: %s → closed (probe успешен)",
                    self._state,
                )
                self._state = STATE_CLOSED
                self._failure_count = 0
                self._opened_at = None

    async def probe_failed(self) -> None:
        """Фиксирует неудачную фоновую пробу primary (внешнее восстановление).

        В ``open`` остаётся open, обновляя ``opened_at`` (для diagnostics).
        В ``half_open`` возвращает в open. В ``closed`` — no-op.
        """
        async with self._lock:
            if self._state == STATE_OPEN:
                self._opened_at = self._clock()
                logger.warning(
                    "Circuit breaker: open остаётся open (probe упал)",
                )
            elif self._state == STATE_HALF_OPEN:
                self._state = STATE_OPEN
                self._opened_at = self._clock()
                logger.warning(
                    "Circuit breaker: half_open → open (probe упал)",
                )


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: CircuitBreaker | None = None


def get_breaker(
    *,
    failure_threshold: int = 2,
    recovery_timeout_sec: int = 60,
    external_recovery: bool = False,
) -> CircuitBreaker:
    """Возвращает process-local breaker, создавая при первом обращении.

    При повторных вызовах с другими параметрами — обновляет конфигурацию
    существующего breaker'а (не пересоздаёт, чтобы не терять state).
    """
    global _instance
    if _instance is None:
        _instance = CircuitBreaker(
            failure_threshold=failure_threshold,
            recovery_timeout_sec=recovery_timeout_sec,
            external_recovery=external_recovery,
        )
    else:
        _instance.configure(
            failure_threshold=failure_threshold,
            recovery_timeout_sec=recovery_timeout_sec,
            external_recovery=external_recovery,
        )
    return _instance


def reset_breaker() -> None:
    """Сбрасывает singleton (для тестов)."""
    global _instance
    _instance = None


def set_breaker(breaker: CircuitBreaker | None) -> None:
    """Подменяет singleton (для тестов с FakeClock)."""
    global _instance
    _instance = breaker
