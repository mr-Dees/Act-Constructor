"""E2E API-тесты эндпоинтов центра уведомлений.

Минимальный FastAPI + dependency_overrides (get_username + сервис-фабрика
на AsyncMock), без реальной БД. Образец — tests/domains/chat/test_chat_api_e2e.py.
"""

from __future__ import annotations

import datetime as dt
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.v1.deps.auth_deps import get_username
from app.core.domain_registry import reset_registry
from app.core.exceptions import AppError
from app.core.settings_registry import reset as reset_settings
from app.domains.notifications.api.notifications import router as notif_router
from app.domains.notifications.deps import get_notification_service

USERNAME = "12345"


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс реестров доменов/настроек между тестами (доменное глоб. состояние)."""
    reset_registry()
    reset_settings()
    yield
    reset_registry()
    reset_settings()


def _build_app(service: object, *, username: str = USERNAME) -> FastAPI:
    """Собирает минимальный FastAPI с роутером уведомлений и оверрайдами DI."""
    app = FastAPI()

    @app.exception_handler(AppError)
    async def _app_err_handler(_request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())

    app.include_router(notif_router, prefix="/api/v1/notifications")
    app.dependency_overrides[get_username] = lambda: username
    app.dependency_overrides[get_notification_service] = lambda: service
    return app


def _make_service() -> MagicMock:
    """Mock NotificationService с async-методами."""
    svc = MagicMock()
    svc.list_for_user = AsyncMock(return_value=[])
    svc.unread_count = AsyncMock(return_value=0)
    svc.mark_read = AsyncMock()
    svc.mark_all_read = AsyncMock()
    svc.dismiss = AsyncMock()
    svc.push = AsyncMock(return_value="new-id")
    return svc


# ── GET /notifications ───────────────────────────────────────────────────────


def test_list_returns_array():
    """GET /notifications возвращает список NotificationOut."""
    svc = _make_service()
    now = dt.datetime(2026, 6, 7, 12, 0, 0)
    svc.list_for_user.return_value = [
        {
            "id": "n1", "source": "acts", "severity": "info",
            "title": "Готов акт", "body": None,
            "link": "/constructor?act_id=42", "element_ref": None,
            "created_at": now, "is_read": False,
        },
    ]
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.get("/api/v1/notifications")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == "n1"
    assert body[0]["link"] == "/constructor?act_id=42"
    assert body[0]["is_read"] is False
    # сервис вызван с username
    assert svc.list_for_user.await_args.args[0] == USERNAME


def test_list_respects_limit_query():
    """GET /notifications?limit=10 прокидывает limit в сервис."""
    svc = _make_service()
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.get("/api/v1/notifications?limit=10")
    assert resp.status_code == 200, resp.text
    assert svc.list_for_user.await_args.kwargs["limit"] == 10


# ── GET /notifications/unread-count ──────────────────────────────────────────


def test_unread_count():
    """GET /notifications/unread-count возвращает {count}."""
    svc = _make_service()
    svc.unread_count.return_value = 7
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.get("/api/v1/notifications/unread-count")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"count": 7}
    assert svc.unread_count.await_args.args[0] == USERNAME


# ── POST /notifications/{id}/read ────────────────────────────────────────────


def test_mark_read():
    """POST /{id}/read помечает прочитанным для текущего пользователя."""
    svc = _make_service()
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.post("/api/v1/notifications/n1/read")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}
    svc.mark_read.assert_awaited_once_with("n1", USERNAME)


# ── POST /notifications/read-all ─────────────────────────────────────────────


def test_mark_all_read():
    """POST /read-all помечает все видимые прочитанными."""
    svc = _make_service()
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.post("/api/v1/notifications/read-all")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}
    svc.mark_all_read.assert_awaited_once_with(USERNAME)


# ── POST /notifications/{id}/dismiss ─────────────────────────────────────────


def test_dismiss():
    """POST /{id}/dismiss скрывает уведомление."""
    svc = _make_service()
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.post("/api/v1/notifications/n1/dismiss")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}
    svc.dismiss.assert_awaited_once_with("n1", USERNAME)


# ── POST /notifications (создание) ───────────────────────────────────────────


def test_create_uses_username_as_created_by():
    """POST /notifications создаёт уведомление, created_by = текущий username."""
    svc = _make_service()
    svc.push.return_value = "created-123"
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/notifications",
            json={
                "source": "manual",
                "title": "Внимание",
                "severity": "warning",
                "recipient_user_id": "67890",
                "link": "/constructor?act_id=1",
            },
        )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"id": "created-123"}
    kwargs = svc.push.await_args.kwargs
    assert kwargs["created_by"] == USERNAME
    assert kwargs["source"] == "manual"
    assert kwargs["title"] == "Внимание"
    assert kwargs["severity"] == "warning"
    assert kwargs["recipient_user_id"] == "67890"
    assert kwargs["link"] == "/constructor?act_id=1"


def test_create_broadcast_default_severity():
    """POST без recipient_user_id → broadcast (None); severity по умолчанию info."""
    svc = _make_service()
    app = _build_app(svc)
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/notifications",
            json={"source": "acts", "title": "Всем привет"},
        )
    assert resp.status_code == 200, resp.text
    kwargs = svc.push.await_args.kwargs
    assert kwargs["recipient_user_id"] is None
    assert kwargs["severity"] == "info"


# ── Общий колокольчик: НЕТ доменного гейта (public_api) ───────────────────────


def test_public_api_skips_domain_gate():
    """register_domains не вешает require_domain_access на public_api-домен:
    рядовой пользователь без роли 'notifications' получает 200, а не 403.

    Регрессия на контракт «общий колокольчик везде» — в отличие от остальных
    тестов файла, монтирует домен через настоящий register_domains, а не
    include_router напрямую (гейт навешивается именно реестром)."""
    from app.core.domain_registry import register_domains
    from app.domains.notifications import _build_domain

    svc = _make_service()
    svc.unread_count.return_value = 3

    app = FastAPI()

    @app.exception_handler(AppError)
    async def _app_err_handler(_request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())

    descriptor = _build_domain()
    assert descriptor.public_api is True, "домен уведомлений должен быть public_api"
    register_domains(app, [descriptor], "/api/v1")
    app.dependency_overrides[get_username] = lambda: USERNAME
    app.dependency_overrides[get_notification_service] = lambda: svc

    with TestClient(app) as client:
        resp = client.get("/api/v1/notifications/unread-count")

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"count": 3}
