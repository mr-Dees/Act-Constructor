"""Тесты для middleware — rate limiting и ограничение размера запроса."""

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from app.core.middleware import RateLimitMiddleware, RequestSizeLimitMiddleware


def _make_size_app(max_size: int) -> FastAPI:
    """Создает FastAPI с RequestSizeLimitMiddleware."""
    app = FastAPI()
    app.add_middleware(RequestSizeLimitMiddleware, max_size=max_size)

    @app.post("/test")
    async def test_endpoint():
        return {"ok": True}

    return app


def _make_rate_app(rate_limit: int) -> FastAPI:
    """Создает FastAPI с RateLimitMiddleware."""
    from unittest.mock import MagicMock

    mock_settings = MagicMock()
    mock_settings.security.max_tracked_ips = 100
    mock_settings.security.rate_limit_ttl = 120

    app = FastAPI()
    app.add_middleware(
        RateLimitMiddleware,
        rate_limit=rate_limit,
        settings=mock_settings,
    )

    @app.get("/test")
    async def test_endpoint():
        return {"ok": True}

    return app


class TestRequestSizeLimitMiddleware:

    async def test_within_limit(self):
        app = _make_size_app(max_size=1024)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post("/test", content=b"small")
            assert resp.status_code == 200

    async def test_exceeds_limit(self):
        app = _make_size_app(max_size=100)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                "/test",
                content=b"x" * 200,
                headers={"content-length": "200"},
            )
            assert resp.status_code == 413


class TestRateLimitMiddleware:

    async def test_allows_normal(self):
        app = _make_rate_app(rate_limit=10)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            for _ in range(5):
                resp = await client.get("/test")
                assert resp.status_code == 200

    async def test_blocks_excess(self):
        app = _make_rate_app(rate_limit=3)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            statuses = []
            for _ in range(6):
                resp = await client.get("/test")
                statuses.append(resp.status_code)
            assert 429 in statuses
