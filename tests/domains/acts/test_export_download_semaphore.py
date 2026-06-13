"""
Тесты инициализации per-worker семафора скачивания (ebe-6).

_get_download_semaphore лениво создаёт module-level семафор. Инициализация
обязана быть безопасной при одновременном первом обращении: создаётся ровно
один семафор с лимитом из настроек, и все вызовы получают один и тот же
объект (двойная проверка под threading.Lock).
"""

import threading
from types import SimpleNamespace

import pytest

from app.domains.acts.api import export as export_module


@pytest.fixture(autouse=True)
def _reset_semaphore(monkeypatch):
    """Сбрасывает module-level семафор между тестами."""
    monkeypatch.setattr(export_module, "_download_semaphore", None)
    yield


def _make_cfg(limit: int):
    """Минимальный настройко-подобный объект с resource.max_concurrent_file_operations."""
    return SimpleNamespace(
        resource=SimpleNamespace(max_concurrent_file_operations=limit)
    )


def test_semaphore_created_once_with_configured_limit():
    """Повторный вызов возвращает тот же объект; лимит — из настроек."""
    cfg = _make_cfg(3)

    sem1 = export_module._get_download_semaphore(cfg)
    sem2 = export_module._get_download_semaphore(_make_cfg(99))

    assert sem1 is sem2
    # Лимит зафиксирован первым вызовом
    assert sem1._value == 3


def test_concurrent_first_calls_get_single_instance():
    """Одновременное первое обращение из потоков — ровно один семафор."""
    cfg = _make_cfg(2)
    n_threads = 16
    barrier = threading.Barrier(n_threads)
    results: list = []

    def worker():
        barrier.wait()
        results.append(export_module._get_download_semaphore(cfg))

    threads = [threading.Thread(target=worker) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == n_threads
    assert len({id(sem) for sem in results}) == 1
