"""Реестр batcher'ов и фоновых задач для diagnostics-endpoint'а.

Любой компонент, поднимающий ``MetricsBatcher`` или похожий долгоживущий
объект, может зарегистрироваться здесь — endpoint ``/admin/diagnostics``
вернёт снимок состояния всех зарегистрированных компонентов.

Реестр процесс-локальный. В JupyterHub-деплое (процесс на пользователя)
это нормально: каждому пользователю интересны только его батчеры.
"""

from __future__ import annotations

from typing import Callable, Protocol, runtime_checkable


@runtime_checkable
class HasGetStatus(Protocol):
    """Протокол: объект с методом ``get_status() -> dict``."""

    def get_status(self) -> dict: ...


_batchers: dict[str, HasGetStatus] = {}
_background_tasks: dict[str, Callable[[], dict]] = {}


def register_batcher(name: str, batcher: HasGetStatus) -> None:
    """Регистрирует batcher (любой объект с методом ``get_status()``).

    Повторная регистрация под тем же именем перезаписывает запись —
    это удобно для тестов и hot-restart сценариев.

    :raises TypeError: если объект не реализует ``get_status() -> dict``.
    """
    if not isinstance(batcher, HasGetStatus):
        raise TypeError(
            f"{batcher!r} не реализует протокол get_status() -> dict",
        )
    _batchers[name] = batcher


def unregister_batcher(name: str) -> None:
    """Удаляет batcher из реестра. Идемпотентно."""
    _batchers.pop(name, None)


def register_background_task(
    name: str, status_fn: Callable[[], dict],
) -> None:
    """Регистрирует фоновую задачу.

    :param status_fn: вызываемая без аргументов, возвращает ``dict`` со
        снимком состояния задачи (как минимум ``name`` и ``running``).
    """
    _background_tasks[name] = status_fn


def unregister_background_task(name: str) -> None:
    """Удаляет фоновую задачу из реестра. Идемпотентно."""
    _background_tasks.pop(name, None)


def get_all_statuses() -> dict:
    """Снимок состояний всех зарегистрированных компонентов.

    :return: словарь с двумя ключами:

        * ``batchers`` — ``dict[name, get_status()]``;
        * ``background_tasks`` — ``dict[name, status_fn()]``.

        При ошибке внутри ``get_status()``/``status_fn()`` запись
        заменяется на ``{"name": name, "error": <текст>}`` — endpoint
        должен показать частичный снимок даже при сбое одного компонента.
    """
    batchers: dict[str, dict] = {}
    for name, batcher in _batchers.items():
        try:
            batchers[name] = batcher.get_status()
        except Exception as exc:
            batchers[name] = {
                "name": name,
                "error": f"{type(exc).__name__}: {exc}",
            }
    tasks: dict[str, dict] = {}
    for name, fn in _background_tasks.items():
        try:
            tasks[name] = fn()
        except Exception as exc:
            tasks[name] = {
                "name": name,
                "error": f"{type(exc).__name__}: {exc}",
            }
    return {"batchers": batchers, "background_tasks": tasks}


def reset() -> None:
    """Сброс реестра (для тестов)."""
    _batchers.clear()
    _background_tasks.clear()
