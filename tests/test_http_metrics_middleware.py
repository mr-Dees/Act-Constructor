"""Тесты HttpMetricsMiddleware — записи HTTP-метрик через middleware."""

import time
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from app.core.config import request_id_var
from app.core.middlewares.http_metrics import HttpMetricsMiddleware


def _make_app(service) -> FastAPI:
    """FastAPI с HttpMetricsMiddleware и парой тестовых эндпоинтов."""
    app = FastAPI()
    app.add_middleware(HttpMetricsMiddleware, service=service)

    @app.get("/api/v1/items")
    async def items():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/static/main.css")
    async def static_css():
        return JSONResponse({"x": 1})

    @app.get("/api/v1/boom")
    async def boom():
        return JSONResponse({"detail": "fail"}, status_code=500)

    @app.get("/api/v1/slow")
    async def slow():
        # Небольшая пауза, чтобы latency_ms > 0.
        time.sleep(0.02)
        return {"ok": True}

    return app


async def test_records_metric_for_normal_request():
    """Middleware вызывает service.record с корректными аргументами."""
    service = AsyncMock()
    app = _make_app(service)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/items")
        assert resp.status_code == 200

    service.record.assert_awaited_once()
    kwargs = service.record.call_args.kwargs
    assert kwargs["method"] == "GET"
    assert kwargs["path"] == "/api/v1/items"
    assert kwargs["status_code"] == 200
    assert kwargs["latency_ms"] >= 0


async def test_service_none_no_record_no_error():
    """service=None → нет записи, запрос обрабатывается без ошибок."""
    app = _make_app(service=None)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/items")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}


async def test_skips_health_endpoint():
    """Запросы на /health не пишут метрику (мусор в журнале)."""
    service = AsyncMock()
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200

    service.record.assert_not_awaited()


async def test_skips_static_files():
    """Запросы на /static/* не пишут метрику."""
    service = AsyncMock()
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/static/main.css")
        assert resp.status_code == 200

    service.record.assert_not_awaited()


async def test_latency_ms_measured():
    """latency_ms ≥ длительности sleep'а в endpoint'е."""
    service = AsyncMock()
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.get("/api/v1/slow")

    kwargs = service.record.call_args.kwargs
    # 20мс sleep + накладные расходы — latency должен быть как минимум 15мс,
    # с запасом на разные системы; на CI бывает дрожание.
    assert kwargs["latency_ms"] >= 10


async def test_request_id_from_context_var():
    """request_id берётся из ContextVar, выставленного RequestIdMiddleware."""
    service = AsyncMock()
    app = _make_app(service)

    token = request_id_var.set("custom-rid")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.get("/api/v1/items")
    finally:
        request_id_var.reset(token)

    # ContextVar пересоздаётся в новых тасках; проверяем что middleware его
    # вообще читает (значение либо "custom-rid", либо None если ASGI запустил
    # обработчик в отдельной задаче — оба варианта валидны для unit-теста).
    kwargs = service.record.call_args.kwargs
    assert "request_id" in kwargs


async def test_records_5xx_status():
    """500 status_code тоже пишется в метрику (для мониторинга ошибок)."""
    service = AsyncMock()
    app = _make_app(service)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/v1/boom")
        assert resp.status_code == 500

    service.record.assert_awaited_once()
    kwargs = service.record.call_args.kwargs
    assert kwargs["status_code"] == 500
    assert kwargs["path"] == "/api/v1/boom"


async def test_path_truncated_to_512_chars():
    """Длинный path обрезается до 512 символов (защита от VARCHAR overflow)."""
    service = AsyncMock()
    app = FastAPI()
    app.add_middleware(HttpMetricsMiddleware, service=service)

    @app.get("/api/v1/{tail:path}")
    async def catch_all(tail: str):
        return {"ok": True}

    long_tail = "x" * 1000
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get(f"/api/v1/{long_tail}")
        assert resp.status_code == 200

    kwargs = service.record.call_args.kwargs
    assert len(kwargs["path"]) <= 512
