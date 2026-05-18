"""Тесты per-domain health-эндпоинта ``GET /health/{domain_name}``.

Покрывает:
- успешный ответ для acts/chat/admin при мокнутой БД,
- degraded-статус чата при "open" circuit breaker'е,
- 404 для неизвестного домена,
- 404 для домена без зарегистрированного ``health_check``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints.system import router as system_router
from app.core.domain import DomainDescriptor
from app.core.domain_registry import reset_registry
import app.core.domain_registry as domain_registry


# -------------------------------------------------------------------------
# Сброс реестра доменов между тестами
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registry():
    reset_registry()
    yield
    reset_registry()


def _register(descriptor: DomainDescriptor) -> None:
    """Прямая подмена внутреннего списка доменов (минуя discover_domains)."""
    domain_registry._domains = [descriptor]


def _build_app() -> FastAPI:
    """Минимальный FastAPI с подключённым system_router (без префикса)."""
    app = FastAPI()
    app.include_router(system_router)
    return app


@asynccontextmanager
async def _fake_get_db(conn):
    yield conn


# -------------------------------------------------------------------------
# acts
# -------------------------------------------------------------------------


def test_health_acts_returns_ok():
    """Импорт acts.health_check'а и его выполнение через мок БД даёт status=ok."""
    from app.domains.acts import _health_check

    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)

    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter._get_existing_tables = AsyncMock(return_value={"acts"})

    with patch("app.db.connection.get_adapter", return_value=adapter), \
         patch("app.db.connection.get_db", lambda: _fake_get_db(conn)):
        from app.core.domain import DomainDescriptor
        descriptor = DomainDescriptor(name="acts", health_check=_health_check)
        _register(descriptor)

        app = _build_app()
        client = TestClient(app)
        resp = client.get("/health/acts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "reachable"
    assert body["tables"] == "present"
    assert body["domain"] == "acts"


def test_health_acts_missing_table_returns_error():
    """Если таблицы acts нет — статус error."""
    from app.domains.acts import _health_check

    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)

    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter._get_existing_tables = AsyncMock(return_value=set())

    with patch("app.db.connection.get_adapter", return_value=adapter), \
         patch("app.db.connection.get_db", lambda: _fake_get_db(conn)):
        _register(DomainDescriptor(name="acts", health_check=_health_check))

        client = TestClient(_build_app())
        resp = client.get("/health/acts")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert body["tables"] == "missing"


# -------------------------------------------------------------------------
# chat
# -------------------------------------------------------------------------


def test_health_chat_circuit_closed_returns_ok():
    """Без circuit breaker (не реализован) — статус ok, llm_circuit=not_configured."""
    from app.domains.chat import _health_check

    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)

    with patch("app.db.connection.get_db", lambda: _fake_get_db(conn)):
        _register(DomainDescriptor(name="chat", health_check=_health_check))

        client = TestClient(_build_app())
        resp = client.get("/health/chat")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "reachable"
    # Circuit breaker модуля нет — поле not_configured либо closed
    assert body["llm_circuit"] in {"not_configured", "closed"}


def test_health_chat_circuit_open_returns_degraded():
    """Если circuit breaker в open state — статус degraded."""
    from app.domains.chat import _health_check

    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)

    # Подсовываем фейковый модуль circuit_breaker.
    import sys
    import types
    fake_module = types.ModuleType("app.domains.chat.services.circuit_breaker")
    fake_breaker = MagicMock()
    fake_breaker.state = "open"
    fake_module.get_breaker = lambda: fake_breaker  # type: ignore

    with patch("app.db.connection.get_db", lambda: _fake_get_db(conn)), \
         patch.dict(sys.modules, {"app.domains.chat.services.circuit_breaker": fake_module}):
        _register(DomainDescriptor(name="chat", health_check=_health_check))

        client = TestClient(_build_app())
        resp = client.get("/health/chat")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["llm_circuit"] == "open"
    assert "fallback" in body.get("note", "")


def test_health_chat_db_unreachable_returns_error():
    """Если БД недоступна — error."""
    from app.domains.chat import _health_check

    @asynccontextmanager
    async def _broken_db():
        raise RuntimeError("pool not initialized")
        yield  # pragma: no cover

    with patch("app.db.connection.get_db", _broken_db):
        _register(DomainDescriptor(name="chat", health_check=_health_check))

        client = TestClient(_build_app())
        resp = client.get("/health/chat")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert "pool not initialized" in body["db"]


# -------------------------------------------------------------------------
# admin
# -------------------------------------------------------------------------


def test_health_admin_returns_ok():
    from app.domains.admin import _health_check

    conn = AsyncMock()
    conn.fetchval = AsyncMock(return_value=1)

    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter._get_existing_tables = AsyncMock(return_value={"roles"})

    with patch("app.db.connection.get_adapter", return_value=adapter), \
         patch("app.db.connection.get_db", lambda: _fake_get_db(conn)):
        _register(DomainDescriptor(name="admin", health_check=_health_check))

        client = TestClient(_build_app())
        resp = client.get("/health/admin")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "reachable"
    assert body["tables"] == "present"


# -------------------------------------------------------------------------
# 404-сценарии
# -------------------------------------------------------------------------


def test_health_unknown_domain_returns_404():
    """Неизвестный домен — 404."""
    client = TestClient(_build_app())
    resp = client.get("/health/nonexistent_domain")

    assert resp.status_code == 404


def test_health_domain_without_health_check_returns_404():
    """Домен зарегистрирован, но health_check=None — 404."""
    _register(DomainDescriptor(name="no_health", health_check=None))

    client = TestClient(_build_app())
    resp = client.get("/health/no_health")

    assert resp.status_code == 404


# -------------------------------------------------------------------------
# Существующие /health и /version не сломаны
# -------------------------------------------------------------------------


def test_existing_health_still_works():
    """Базовый /health не должен сломаться при добавлении нового маршрута."""
    client = TestClient(_build_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
