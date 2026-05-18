"""Per-user rate limiter для эндпоинта отправки сообщений.

Реализует sliding window (скользящее окно 60 секунд) на основе
списка timestamps в памяти процесса. Корректен в режиме single-worker
(гарантируется `acquire_singleton_lock` в lifespan приложения).
"""

import asyncio
import time

from app.domains.chat.exceptions import ChatRateLimitError

_WINDOW_SEC = 60

# Словарь user_id → список monotonic timestamps запросов в текущем окне.
# Lazy init через явный dict (не defaultdict) — asyncio.Lock нельзя создавать
# до запуска event loop (см. CLAUDE.md «In-process asyncio.Lock»).
_timestamps: dict[str, list[float]] = {}
_locks: dict[str, asyncio.Lock] = {}
_global_lock: asyncio.Lock | None = None


def _get_global_lock() -> asyncio.Lock:
    """Возвращает глобальный лок для защиты создания per-user локов."""
    global _global_lock
    if _global_lock is None:
        _global_lock = asyncio.Lock()
    return _global_lock


async def _get_user_lock(user_id: str) -> asyncio.Lock:
    """Возвращает (создаёт при необходимости) per-user asyncio.Lock."""
    if user_id not in _locks:
        async with _get_global_lock():
            # double-checked locking
            if user_id not in _locks:
                _locks[user_id] = asyncio.Lock()
    return _locks[user_id]


class UserRateLimiter:
    """Sliding-window rate limiter на уровне user_id.

    Параметры:
        limit: максимальное количество запросов за 60 секунд от одного пользователя.
    """

    def __init__(self, limit: int) -> None:
        if limit < 1:
            raise ValueError(f"limit должен быть ≥ 1, получено {limit}")
        self.limit = limit

    async def check_and_consume(self, user_id: str) -> None:
        """Проверяет и регистрирует запрос пользователя.

        Бросает ChatRateLimitError, если за последние 60 секунд
        уже было `limit` запросов от данного user_id.
        """
        lock = await _get_user_lock(user_id)
        async with lock:
            now = time.monotonic()
            cutoff = now - _WINDOW_SEC

            # Инициализируем список если нет
            if user_id not in _timestamps:
                _timestamps[user_id] = []

            # Очищаем устаревшие метки
            recent = [ts for ts in _timestamps[user_id] if ts > cutoff]

            if len(recent) >= self.limit:
                raise ChatRateLimitError(
                    "Слишком частые запросы. Подождите минуту перед следующим сообщением.",
                    retry_after_sec=_WINDOW_SEC,
                )

            recent.append(now)
            _timestamps[user_id] = recent


def reset_state() -> None:
    """Сбрасывает внутреннее состояние лимитера (только для тестов)."""
    global _global_lock
    _timestamps.clear()
    _locks.clear()
    _global_lock = None
