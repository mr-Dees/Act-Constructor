"""Реестр action-handlers для кнопок чата."""
from __future__ import annotations

from typing import Any, Awaitable, Callable

_action_handlers: dict[str, dict[str, Any]] = {}


def register_action_handler(
    action_id: str,
    domain: str,
    handler: Callable[..., Awaitable[Any]],
    label: str,
) -> None:
    """Регистрирует обработчик action-кнопки."""
    if action_id in _action_handlers:
        raise RuntimeError(f"Action handler '{action_id}' already registered")
    _action_handlers[action_id] = {
        "action_id": action_id,
        "domain": domain,
        "handler": handler,
        "label": label,
    }


def get_action_handler(action_id: str) -> dict[str, Any] | None:
    """Возвращает обработчик по идентификатору действия."""
    return _action_handlers.get(action_id)


def get_all_action_handlers() -> list[dict[str, Any]]:
    """Возвращает все зарегистрированные обработчики."""
    return list(_action_handlers.values())


def reset_action_handlers() -> None:
    """Сброс реестра (для тестов)."""
    _action_handlers.clear()
