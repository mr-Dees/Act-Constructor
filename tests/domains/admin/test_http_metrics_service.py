"""Тесты HttpMetricsService — фасада записи HTTP-метрик."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.admin.services.http_metrics_service import HttpMetricsService


@pytest.fixture
def mock_repo_class():
    """Подменяет класс репозитория в модуле сервиса."""
    with patch(
        "app.domains.admin.services.http_metrics_service.HttpMetricsRepository"
    ) as cls:
        instance = MagicMock()
        instance.record = AsyncMock()
        cls.return_value = instance
        yield cls, instance


@pytest.fixture
def mock_get_db():
    """Подменяет get_db на пустой async context manager."""
    conn = MagicMock()

    @asynccontextmanager
    async def _fake_get_db():
        yield conn

    with patch(
        "app.domains.admin.services.http_metrics_service.get_db",
        _fake_get_db,
    ):
        yield conn


async def test_record_calls_repo(mock_repo_class, mock_get_db):
    """Успешный путь: сервис создаёт repo и вызывает record с теми же аргументами."""
    _, repo = mock_repo_class
    service = HttpMetricsService()
    await service.record(
        method="GET",
        path="/api/v1/acts",
        status_code=200,
        latency_ms=42,
        username="22494524",
        request_id="abc",
    )
    repo.record.assert_awaited_once_with(
        method="GET",
        path="/api/v1/acts",
        status_code=200,
        latency_ms=42,
        username="22494524",
        request_id="abc",
    )


async def test_record_swallows_repo_exception(mock_repo_class, mock_get_db, caplog):
    """Исключение из repo проглатывается с warning-логом — наружу не пробрасывается."""
    _, repo = mock_repo_class
    repo.record.side_effect = RuntimeError("DB exploded")

    service = HttpMetricsService()
    # Не должно быть исключения
    await service.record(
        method="POST",
        path="/api/v1/test",
        status_code=500,
        latency_ms=10,
        username=None,
        request_id=None,
    )
    assert any(
        "Не удалось записать HTTP-метрику" in rec.message
        for rec in caplog.records
    )


async def test_record_swallows_get_db_exception(mock_repo_class, caplog):
    """Если get_db падает (пул закрыт) — исключение тоже проглатывается."""
    @asynccontextmanager
    async def _broken_get_db():
        raise RuntimeError("pool closed")
        yield  # unreachable

    with patch(
        "app.domains.admin.services.http_metrics_service.get_db",
        _broken_get_db,
    ):
        service = HttpMetricsService()
        await service.record(
            method="GET",
            path="/api/v1/x",
            status_code=200,
            latency_ms=1,
            username=None,
            request_id=None,
        )
    assert any(
        "Не удалось записать HTTP-метрику" in rec.message
        for rec in caplog.records
    )


async def test_record_with_null_username(mock_repo_class, mock_get_db):
    """Username=None пробрасывается без преобразования."""
    _, repo = mock_repo_class
    service = HttpMetricsService()
    await service.record(
        method="GET",
        path="/health",
        status_code=200,
        latency_ms=2,
        username=None,
        request_id=None,
    )
    repo.record.assert_awaited_once()
    kwargs = repo.record.call_args.kwargs
    assert kwargs["username"] is None
    assert kwargs["request_id"] is None


async def test_record_with_5xx_status(mock_repo_class, mock_get_db):
    """5xx-статусы пишутся так же, как 2xx (мониторинг ошибок)."""
    _, repo = mock_repo_class
    service = HttpMetricsService()
    await service.record(
        method="POST",
        path="/api/v1/acts",
        status_code=500,
        latency_ms=1500,
        username="22494524",
        request_id="r1",
    )
    repo.record.assert_awaited_once()
    assert repo.record.call_args.kwargs["status_code"] == 500


async def test_record_preserves_arguments_when_repo_raises(
    mock_repo_class, mock_get_db
):
    """Аргументы передаются в repo даже если он падает (для отладки extra-логов)."""
    _, repo = mock_repo_class
    repo.record.side_effect = RuntimeError("x")
    service = HttpMetricsService()
    await service.record(
        method="GET",
        path="/api/v1/y",
        status_code=200,
        latency_ms=5,
        username="u",
        request_id="r",
    )
    repo.record.assert_awaited_once()
    assert repo.record.call_args.kwargs["path"] == "/api/v1/y"


async def test_record_uses_batcher_when_provided(mock_repo_class, mock_get_db):
    """Если в конструктор передан batcher — запись идёт в него, repo НЕ зовётся."""
    _, repo = mock_repo_class
    batcher = AsyncMock()
    batcher.add = AsyncMock()
    service = HttpMetricsService(batcher=batcher)
    await service.record(
        method="GET",
        path="/api/v1/x",
        status_code=200,
        latency_ms=42,
        username="u",
        request_id="r",
    )
    batcher.add.assert_awaited_once()
    record = batcher.add.call_args.args[0]
    assert record.method == "GET"
    assert record.path == "/api/v1/x"
    assert record.status_code == 200
    assert record.latency_ms == 42
    assert record.username == "u"
    assert record.request_id == "r"
    # repo НЕ должен быть зван — мы шли через батчер.
    repo.record.assert_not_called()


async def test_record_falls_back_to_module_batcher(mock_repo_class, mock_get_db):
    """Если конструктор без batcher, но в deps установлен module-level — используется он."""
    from app.domains.admin import deps as admin_deps

    _, repo = mock_repo_class
    module_batcher = AsyncMock()
    module_batcher.add = AsyncMock()
    admin_deps.set_http_metrics_batcher(module_batcher)
    try:
        service = HttpMetricsService()  # без batcher
        await service.record(
            method="GET",
            path="/api/v1/z",
            status_code=200,
            latency_ms=1,
            username=None,
            request_id=None,
        )
        module_batcher.add.assert_awaited_once()
        repo.record.assert_not_called()
    finally:
        admin_deps.set_http_metrics_batcher(None)
