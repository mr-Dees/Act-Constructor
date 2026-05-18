"""Тесты per-user rate limiter (sliding window, 60 секунд)."""

from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from app.domains.chat.exceptions import ChatRateLimitError
from app.domains.chat.services import user_rate_limiter as rl_module
from app.domains.chat.services.user_rate_limiter import UserRateLimiter


# ---------------------------------------------------------------------------
# Autouse: сбрасываем состояние лимитера между тестами
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_limiter_state():
    """Сброс глобального состояния лимитера перед каждым тестом."""
    rl_module.reset_state()
    yield
    rl_module.reset_state()


# ---------------------------------------------------------------------------
# Вспомогательный класс для управления «виртуальным» временем
# ---------------------------------------------------------------------------


class FakeClock:
    """Обёртка над `time.monotonic` для детерминированного управления временем."""

    def __init__(self, start: float = 0.0) -> None:
        self._now = start

    def advance(self, seconds: float) -> None:
        self._now += seconds

    def __call__(self) -> float:
        return self._now


# ---------------------------------------------------------------------------
# Тесты основной логики sliding window
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_11th_request_raises_rate_limit_error():
    """11-й запрос от одного пользователя за 60 сек должен поднимать ChatRateLimitError."""
    limiter = UserRateLimiter(limit=10)
    clock = FakeClock(start=1000.0)

    with patch.object(rl_module, "_WINDOW_SEC", 60), \
         patch("app.domains.chat.services.user_rate_limiter.time") as mock_time:
        mock_time.monotonic = clock

        for i in range(10):
            clock.advance(0.1)  # небольшой сдвиг внутри окна
            await limiter.check_and_consume("user1")

        # 11-й — должен упасть
        with pytest.raises(ChatRateLimitError) as exc_info:
            await limiter.check_and_consume("user1")

    assert exc_info.value.status_code == 429
    assert exc_info.value.retry_after_sec == 60
    assert "Слишком частые запросы" in str(exc_info.value)


@pytest.mark.asyncio
async def test_two_users_5_requests_each_all_pass():
    """10 запросов от двух разных users (по 5 каждый) — все должны пройти."""
    limiter = UserRateLimiter(limit=10)
    clock = FakeClock(start=1000.0)

    with patch("app.domains.chat.services.user_rate_limiter.time") as mock_time:
        mock_time.monotonic = clock

        for _ in range(5):
            clock.advance(0.1)
            await limiter.check_and_consume("alice")
            await limiter.check_and_consume("bob")

    # Оба пользователя прошли без исключений — тест пройден


@pytest.mark.asyncio
async def test_window_expiry_resets_counter():
    """После истечения окна 60 сек счётчик сбрасывается и запросы проходят снова."""
    limiter = UserRateLimiter(limit=10)
    clock = FakeClock(start=1000.0)

    with patch("app.domains.chat.services.user_rate_limiter.time") as mock_time:
        mock_time.monotonic = clock

        # Исчерпываем лимит
        for _ in range(10):
            clock.advance(0.1)
            await limiter.check_and_consume("user1")

        # 11-й — падает
        with pytest.raises(ChatRateLimitError):
            await limiter.check_and_consume("user1")

        # Перематываем время на 61 секунду вперёд — все старые метки протухли
        clock.advance(61.0)

        # Теперь снова можно делать 10 запросов
        for _ in range(10):
            clock.advance(0.1)
            await limiter.check_and_consume("user1")


@pytest.mark.asyncio
async def test_rate_limit_error_fields():
    """ChatRateLimitError несёт правильный status_code и retry_after_sec."""
    err = ChatRateLimitError("тест", retry_after_sec=60)
    assert err.status_code == 429
    assert err.retry_after_sec == 60
    assert err.message == "тест"


@pytest.mark.asyncio
async def test_limit_validation():
    """UserRateLimiter отклоняет limit < 1."""
    with pytest.raises(ValueError, match="≥ 1"):
        UserRateLimiter(limit=0)


@pytest.mark.asyncio
async def test_sliding_window_partial_expiry():
    """Проверяет, что только старые метки вытесняются, новые остаются."""
    limiter = UserRateLimiter(limit=5)
    clock = FakeClock(start=1000.0)

    with patch("app.domains.chat.services.user_rate_limiter.time") as mock_time:
        mock_time.monotonic = clock

        # 3 запроса в t=1000
        for _ in range(3):
            await limiter.check_and_consume("user1")

        # Прокручиваем 61 секунду — эти 3 метки протухают
        clock.advance(61.0)

        # Ещё 4 запроса в t=1061
        for _ in range(4):
            await limiter.check_and_consume("user1")

        # Итого активных меток: 4 (старые 3 ушли). 5-й — должен пройти
        await limiter.check_and_consume("user1")  # 5-й за актуальное окно

        # 6-й — превышает limit=5
        with pytest.raises(ChatRateLimitError):
            await limiter.check_and_consume("user1")
