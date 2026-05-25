"""E2E-тесты для shared system-эндпоинтов.

Покрывает ``POST /api/v1/system/client-error``: приём отчёта от глобального
error-boundary фронтенда, логирование WARNING'ом, per-user rate-limit.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import importlib

from app.api.v1.deps.auth_deps import get_username

# Прямой import_module — потому что app.api.v1.endpoints.__init__ переэкспортит
# имя `system` как APIRouter и затмевает модуль через нотацию точки.
system_module = importlib.import_module("app.api.v1.endpoints.system")
system_router = system_module.router


@pytest.fixture(autouse=True)
def _reset_rate_limit_state():
    """Сбрасывает per-user rate-limit между тестами."""
    system_module._client_error_timestamps.clear()
    yield
    system_module._client_error_timestamps.clear()


def _build_app(username: str = "22494524") -> FastAPI:
    app = FastAPI()
    app.include_router(system_router, prefix="/api/v1/system")
    app.dependency_overrides[get_username] = lambda: username
    return app


def test_client_error_returns_204_and_logs_warning(caplog):
    """Валидный payload → 204, в логе появилось WARNING с user/payload."""
    app = _build_app(username="22494524")
    client = TestClient(app)

    payload = {
        "type": "error",
        "message": "TypeError: foo is not a function",
        "url": "/static/js/shared/api.js",
        "lineno": 42,
        "colno": 7,
        "stack": "at saveActContent (api.js:42)",
        "userAgent": "Mozilla/5.0 ...",
        "currentActId": 123,
    }

    with caplog.at_level(logging.WARNING, logger="audit_workstation.api.system"):
        resp = client.post("/api/v1/system/client-error", json=payload)

    assert resp.status_code == 204, resp.text
    # 204 = no body
    assert resp.content == b""

    # В логе должна быть одна запись с user и message
    relevant = [r for r in caplog.records if "[client-error]" in r.message]
    assert len(relevant) == 1, f"Ожидали 1 WARNING, получили {len(relevant)}"
    rec = relevant[0]
    assert rec.levelname == "WARNING"
    assert "user=22494524" in rec.message
    assert "TypeError" in rec.message


def test_client_error_rejects_invalid_payload():
    """Невалидное тело (нет обязательных полей) → 422."""
    app = _build_app()
    client = TestClient(app)

    # Нет обязательного 'message'
    resp = client.post("/api/v1/system/client-error", json={"type": "error"})
    assert resp.status_code == 422


def test_client_error_rate_limit_returns_429():
    """11-й запрос за окно → 429, лимит = 10/мин/юзер."""
    app = _build_app(username="22494524")
    client = TestClient(app)

    payload = {"type": "error", "message": "boom"}

    # Первые 10 — 204
    for i in range(10):
        resp = client.post("/api/v1/system/client-error", json=payload)
        assert resp.status_code == 204, f"Запрос {i + 1}: {resp.text}"

    # 11-й — 429
    resp = client.post("/api/v1/system/client-error", json=payload)
    assert resp.status_code == 429
    assert "лимит" in resp.json()["detail"].lower()


def test_client_error_rate_limit_is_per_user():
    """Лимит у одного юзера не блокирует другого."""
    payload = {"type": "error", "message": "boom"}

    # Юзер A забивает лимит
    app_a = _build_app(username="alice")
    client_a = TestClient(app_a)
    for _ in range(10):
        assert client_a.post("/api/v1/system/client-error", json=payload).status_code == 204
    assert client_a.post("/api/v1/system/client-error", json=payload).status_code == 429

    # Юзер B спокойно проходит
    app_b = _build_app(username="bob")
    client_b = TestClient(app_b)
    resp = client_b.post("/api/v1/system/client-error", json=payload)
    assert resp.status_code == 204


def test_client_error_accepts_unhandledrejection_type():
    """Поддерживается тип 'unhandledrejection' (второй обработчик boundary)."""
    app = _build_app()
    client = TestClient(app)

    payload = {
        "type": "unhandledrejection",
        "message": "Promise rejected: Network error",
        "stack": "Error: Network error\n    at fetch",
    }
    resp = client.post("/api/v1/system/client-error", json=payload)
    assert resp.status_code == 204
