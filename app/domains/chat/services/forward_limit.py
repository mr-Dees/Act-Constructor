"""In-process счётчик активных forward'ов на пользователя.

POST /messages SSE короткий (yield-нул ``agent_request_started`` и закрылся),
поэтому семафор из ``app.domains.chat.api.messages`` НЕ ограничивает число
форвардов в полёте — он считает только живые POST SSE-сокеты. Реальное
ограничение «N одновременных forward'ов на юзера» делает этот модуль.

Счётчик инкрементится в :func:`forward_bridge.handle_forward_call` ДО
``agent_bridge_runner.schedule(...)``; декрементится в finally
``agent_bridge_runner._run`` при ЛЮБОМ терминальном статусе (success / error /
timeout / runner crash). Lifespan-reconcile (:func:`schedule_pending`)
делает ``acquire_no_check`` для каждого подхваченного pending-запроса —
без этого после рестарта uvicorn БД помнит N pending, а счётчик 0, и
пользователь может создать LIMIT+N форвардов одновременно.
"""

from __future__ import annotations

from app.domains.chat.exceptions import ChatLimitError

_active: dict[str, int] = {}


def check_and_acquire(user_id: str, limit: int) -> None:
    """Если current < limit — инкремент. Иначе :class:`ChatLimitError`."""
    current = _active.get(user_id, 0)
    if current >= limit:
        raise ChatLimitError(
            f"Достигнут лимит одновременных запросов к внешнему агенту: "
            f"{limit}. Дождитесь окончания текущих.",
        )
    _active[user_id] = current + 1


def acquire_no_check(user_id: str) -> None:
    """Инкремент без проверки лимита — для reconcile при старте."""
    _active[user_id] = _active.get(user_id, 0) + 1


def release(user_id: str) -> None:
    """Декремент с clamp до 0."""
    _active[user_id] = max(0, _active.get(user_id, 0) - 1)


def reset() -> None:
    """Очистка счётчика — для тестов."""
    _active.clear()


def get_count(user_id: str) -> int:
    """Текущий счётчик для пользователя."""
    return _active.get(user_id, 0)
