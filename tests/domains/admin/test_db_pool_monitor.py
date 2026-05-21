"""Тесты DbPoolMonitor — фонового мониторинга asyncpg-пула."""
from __future__ import annotations

import asyncio
import logging

import pytest

from app.domains.admin.services.db_pool_monitor import DbPoolMonitor


def _fake_pool(size: int, idle: int, max_size: int):
    """Создаёт mock-объект, повторяющий API asyncpg.Pool."""
    class _Pool:
        def get_size(self):  # noqa: D401
            return size
        def get_idle_size(self):
            return idle
        def get_max_size(self):
            return max_size
    return _Pool()


async def test_monitor_warns_when_pool_above_threshold(monkeypatch, caplog):
    """При acquired/max >= warn_ratio эмитим WARNING (один раз на серию)."""
    # acquired = 18, max = 20 → ratio 0.9 == warn_ratio
    fake = _fake_pool(size=20, idle=2, max_size=20)
    monkeypatch.setattr(
        "app.db.connection.get_pool", lambda: fake,
    )

    monitor = DbPoolMonitor(check_interval_sec=1.0, warn_ratio=0.9)
    # Подменяем _check_interval_sec через прямой доступ к private-полю —
    # тестам нужна короткая итерация. Public API не поддерживает override.
    monitor._check_interval_sec = 0.01

    caplog.set_level(
        logging.WARNING,
        logger="audit_workstation.domains.admin.db_pool_monitor",
    )
    await monitor.start()
    await asyncio.sleep(0.05)  # 3-4 тика
    await monitor.stop()

    warning_records = [r for r in caplog.records if r.levelname == "WARNING"]
    # Один раз — throttle через _warning_active
    assert len(warning_records) == 1, (
        f"Ожидался один WARNING (throttle), получено {len(warning_records)}"
    )
    msg = warning_records[0].message
    assert "пул близок к лимиту" in msg
    assert "acquired=18/20" in msg


async def test_monitor_does_not_warn_on_low_usage(monkeypatch, caplog):
    """При acquired/max ниже warn_ratio WARNING не эмитим."""
    # acquired = 5, max = 20 → ratio 0.25
    fake = _fake_pool(size=20, idle=15, max_size=20)
    monkeypatch.setattr("app.db.connection.get_pool", lambda: fake)

    monitor = DbPoolMonitor(check_interval_sec=1.0, warn_ratio=0.9)
    monitor._check_interval_sec = 0.01

    caplog.set_level(
        logging.WARNING,
        logger="audit_workstation.domains.admin.db_pool_monitor",
    )
    await monitor.start()
    await asyncio.sleep(0.04)
    await monitor.stop()

    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert warnings == [], (
        f"WARNING не должен эмититься при низкой нагрузке: {warnings}"
    )


async def test_monitor_recovers_warning_state(monkeypatch, caplog):
    """Сначала WARNING (high), потом INFO «нормализовано» при возврате к норме."""
    state = {"phase": "high"}

    def fake_get_pool():
        if state["phase"] == "high":
            return _fake_pool(size=20, idle=1, max_size=20)
        return _fake_pool(size=20, idle=15, max_size=20)

    monkeypatch.setattr("app.db.connection.get_pool", fake_get_pool)

    monitor = DbPoolMonitor(check_interval_sec=1.0, warn_ratio=0.9)
    monitor._check_interval_sec = 0.01

    caplog.set_level(
        logging.INFO,
        logger="audit_workstation.domains.admin.db_pool_monitor",
    )
    await monitor.start()
    await asyncio.sleep(0.03)  # пару тиков в high
    state["phase"] = "low"
    await asyncio.sleep(0.05)  # пару тиков в low
    await monitor.stop()

    levels = [r.levelname for r in caplog.records]
    msgs = [r.message for r in caplog.records]

    assert "WARNING" in levels, "Ожидался хотя бы один WARNING в high-фазе"
    assert any("нормализована" in m for m in msgs), (
        "Ожидался info-лог 'нагрузка на пул нормализована' после возврата"
    )


async def test_monitor_handles_uninitialized_pool(monkeypatch, caplog):
    """Если get_pool() выбрасывает RuntimeError — цикл продолжает работу."""
    def fake_get_pool():
        raise RuntimeError("pool не инициализирован")

    monkeypatch.setattr("app.db.connection.get_pool", fake_get_pool)

    monitor = DbPoolMonitor(check_interval_sec=1.0, warn_ratio=0.9)
    monitor._check_interval_sec = 0.01

    await monitor.start()
    await asyncio.sleep(0.04)
    # Task должен быть всё ещё активным — цикл переживает RuntimeError
    assert monitor._task is not None and not monitor._task.done()
    await monitor.stop()


def test_monitor_validates_arguments():
    """Конструктор отвергает невалидные параметры."""
    with pytest.raises(ValueError, match="check_interval_sec"):
        DbPoolMonitor(check_interval_sec=0.5, warn_ratio=0.9)
    with pytest.raises(ValueError, match="warn_ratio"):
        DbPoolMonitor(check_interval_sec=10.0, warn_ratio=1.5)
    with pytest.raises(ValueError, match="warn_ratio"):
        DbPoolMonitor(check_interval_sec=10.0, warn_ratio=0.0)
