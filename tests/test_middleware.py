"""Тесты для middleware — rate limiting, ограничение размера запроса и security-заголовки."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from httpx import ASGITransport, AsyncClient

from app.core.config import SecuritySettings
from app.core.middleware import (
    RateLimitMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)


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


def _make_security_app(security: SecuritySettings) -> FastAPI:
    """Создает FastAPI с SecurityHeadersMiddleware.

    SecuritySettings инстанцируется напрямую (BaseModel, без чтения .env),
    оборачивается в лёгкий namespace под ожидаемый middleware-контракт
    ``settings.security``. Эндпоинт возвращает nonce из request.state,
    чтобы тест мог сверить заголовок CSP с тем, что увидит шаблон.
    """
    settings = SimpleNamespace(security=security)
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)

    @app.get("/test")
    async def test_endpoint(request: Request):
        nonce = getattr(request.state, "csp_nonce", None)
        return PlainTextResponse(nonce or "")

    return app


def _script_src(csp_value: str) -> str:
    """Вырезает директиву script-src из значения CSP-заголовка."""
    for directive in csp_value.split(";"):
        directive = directive.strip()
        if directive.startswith("script-src"):
            return directive
    return ""


class TestSecurityHeadersMiddleware:

    async def test_enforce_header_name(self):
        """При csp_report_only=False заголовок — content-security-policy (enforce)."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            assert "content-security-policy" in resp.headers
            assert "content-security-policy-report-only" not in resp.headers

    async def test_report_only_header_name(self):
        """При csp_report_only=True заголовок — report-only-вариант."""
        sec = SecuritySettings(csp_report_only=True)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            assert "content-security-policy-report-only" in resp.headers

    async def test_script_src_has_nonce_no_unsafe_inline(self):
        """script-src содержит 'nonce-...' и НЕ содержит 'unsafe-inline'."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            script_src = _script_src(resp.headers["content-security-policy"])
            assert "'nonce-" in script_src
            assert "'unsafe-inline'" not in script_src

    async def test_nonce_matches_request_state(self):
        """nonce в заголовке совпадает с request.state.csp_nonce (его видит шаблон)."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            state_nonce = resp.text
            assert state_nonce  # endpoint вернул непустой nonce
            assert f"'nonce-{state_nonce}'" in resp.headers["content-security-policy"]

    async def test_nonce_differs_per_request(self):
        """Каждый запрос получает свежий nonce."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp1 = await client.get("/test")
            resp2 = await client.get("/test")
            csp1 = resp1.headers["content-security-policy"]
            csp2 = resp2.headers["content-security-policy"]
            assert csp1 != csp2
            assert resp1.text != resp2.text

    async def test_style_src_keeps_unsafe_inline(self):
        """style-src сохраняет 'unsafe-inline' (вынос inline-стилей вне скоупа)."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            csp = resp.headers["content-security-policy"]
            style_src = next(
                d.strip() for d in csp.split(";") if d.strip().startswith("style-src")
            )
            assert "'unsafe-inline'" in style_src

    async def test_other_security_headers_present(self):
        """Остальные security-заголовки выставляются вместе с CSP."""
        sec = SecuritySettings(csp_report_only=False)
        app = _make_security_app(sec)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.get("/test")
            assert resp.headers["x-content-type-options"] == "nosniff"
            assert resp.headers["x-frame-options"] == sec.frame_options
            assert "referrer-policy" in resp.headers
            assert "permissions-policy" in resp.headers
