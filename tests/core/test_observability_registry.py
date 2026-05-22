"""Тесты ``app.core.observability_registry``."""

from __future__ import annotations

import pytest

from app.core import observability_registry as obs


@pytest.fixture(autouse=True)
def _reset_registry():
    """Сброс реестра между тестами — глобальное состояние."""
    obs.reset()
    yield
    obs.reset()


class _StaticBatcher:
    """Заглушка с ``get_status()`` — реализует ``HasGetStatus``."""

    def __init__(self, name: str, payload: dict | None = None):
        self._name = name
        self._payload = payload or {"name": name, "buffer_size": 0}

    def get_status(self) -> dict:
        return dict(self._payload)


def test_register_batcher_then_get_all_statuses():
    """register_batcher → get_all_statuses возвращает зарегистрированных."""
    b1 = _StaticBatcher("admin.x", {"name": "admin.x", "buffer_size": 5})
    b2 = _StaticBatcher("chat.y", {"name": "chat.y", "buffer_size": 1})
    obs.register_batcher("admin.x", b1)
    obs.register_batcher("chat.y", b2)
    snap = obs.get_all_statuses()
    assert set(snap["batchers"].keys()) == {"admin.x", "chat.y"}
    assert snap["batchers"]["admin.x"]["buffer_size"] == 5
    assert snap["batchers"]["chat.y"]["buffer_size"] == 1
    assert snap["background_tasks"] == {}


def test_unregister_batcher_removes_entry():
    """unregister_batcher удаляет запись; повторный вызов — no-op."""
    obs.register_batcher("a", _StaticBatcher("a"))
    obs.unregister_batcher("a")
    assert obs.get_all_statuses()["batchers"] == {}
    # Идемпотентно
    obs.unregister_batcher("a")
    obs.unregister_batcher("never_registered")


def test_register_background_task_and_unregister():
    """register/unregister_background_task — симметрично."""
    obs.register_background_task("t1", lambda: {"name": "t1", "running": True})
    snap = obs.get_all_statuses()
    assert snap["background_tasks"]["t1"] == {"name": "t1", "running": True}
    obs.unregister_background_task("t1")
    assert obs.get_all_statuses()["background_tasks"] == {}
    obs.unregister_background_task("t1")  # идемпотентно


def test_reset_clears_both_maps():
    """reset() чистит и batcher'ы и background_tasks."""
    obs.register_batcher("b", _StaticBatcher("b"))
    obs.register_background_task("t", lambda: {"name": "t", "running": False})
    obs.reset()
    snap = obs.get_all_statuses()
    assert snap["batchers"] == {}
    assert snap["background_tasks"] == {}


def test_register_batcher_rejects_object_without_get_status():
    """register_batcher падает TypeError на объекте без get_status."""

    class _NoStatus:
        pass

    with pytest.raises(TypeError, match="get_status"):
        obs.register_batcher("bad", _NoStatus())


def test_register_batcher_overwrites_same_name():
    """Повторная регистрация под тем же именем перезаписывает."""
    obs.register_batcher("x", _StaticBatcher("x", {"v": 1}))
    obs.register_batcher("x", _StaticBatcher("x", {"v": 2}))
    snap = obs.get_all_statuses()
    assert snap["batchers"]["x"]["v"] == 2


def test_get_all_statuses_isolates_failures():
    """Если один get_status() падает — остальные всё равно отдают данные."""

    class _BrokenBatcher:
        def get_status(self) -> dict:
            raise RuntimeError("oops")

    obs.register_batcher("good", _StaticBatcher("good", {"ok": True}))
    obs.register_batcher("broken", _BrokenBatcher())

    def _failing_task() -> dict:
        raise ValueError("task fail")

    obs.register_background_task("ok_task", lambda: {"running": True})
    obs.register_background_task("bad_task", _failing_task)

    snap = obs.get_all_statuses()
    assert snap["batchers"]["good"] == {"ok": True}
    assert "error" in snap["batchers"]["broken"]
    assert "RuntimeError" in snap["batchers"]["broken"]["error"]
    assert snap["background_tasks"]["ok_task"] == {"running": True}
    assert "error" in snap["background_tasks"]["bad_task"]
    assert "ValueError" in snap["background_tasks"]["bad_task"]["error"]
