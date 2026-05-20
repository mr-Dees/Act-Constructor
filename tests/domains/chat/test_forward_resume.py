"""E2E API-тесты resume forward-запросов внешнего агента.

Тесты собираем как ``test_chat_api_e2e.py``: минимальный ``FastAPI``,
подключаем нужные роутеры, переопределяем DI через
``app.dependency_overrides``. См. CLAUDE.md → раздел Testing.

Покрытие первого коммита (active-forward):
* 200 с pending/in_progress request_id,
* 204 при отсутствии активных,
* 404 на чужую беседу (ownership-проверка в conv_service).
"""

from __future__ import annotations

import datetime as dt
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import get_user_roles
from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.exceptions import AppError
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.api.conversations import router as conv_router
from app.domains.chat.api.forward_resume import router as forward_resume_router
from app.domains.chat.deps import get_conversation_service
from app.domains.chat.exceptions import ConversationNotFoundError
from app.domains.chat.settings import ChatDomainSettings


USERNAME = "12345"


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс реестров доменов/настроек/инструментов между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    yield
    reset_registry()
    reset_settings()
    reset_tools()


def _make_settings() -> ChatDomainSettings:
    return ChatDomainSettings(api_base="", api_key="", model="gpt-4o")


def _make_conv_service(settings: ChatDomainSettings) -> MagicMock:
    svc = MagicMock()
    svc.settings = settings
    svc.get = AsyncMock(return_value={
        "id": "conv-1",
        "user_id": USERNAME,
        "title": None,
        "domain_name": None,
        "context": None,
    })
    return svc


def _build_app(
    *,
    conv_service: object,
    username: str = USERNAME,
) -> FastAPI:
    app = FastAPI()

    @app.exception_handler(AppError)
    async def _app_err_handler(_request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_detail())

    app.include_router(conv_router, prefix="/api/v1/chat")
    app.include_router(forward_resume_router, prefix="/api/v1/chat")

    app.dependency_overrides[get_username] = lambda: username
    app.dependency_overrides[get_user_roles] = lambda: [
        {"id": 1, "name": "Админ", "domain_name": None},
    ]
    app.dependency_overrides[get_conversation_service] = lambda: conv_service
    return app


def _make_db_ctx(conn: AsyncMock) -> AsyncMock:
    """async-context-manager, возвращающий заданный conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


class TestActiveForward:
    """E2E: ``GET /conversations/{cid}/active-forward``."""

    def test_active_forward_returns_pending_request(self):
        """При наличии активного forward — 200 с request_id и status."""
        settings = _make_settings()
        conv = _make_conv_service(settings)

        created = dt.datetime(2026, 5, 20, 17, 35, 21)
        active_row = {
            "id": "agent-req-1",
            "status": "in_progress",
            "created_at": created,
            "message_id": "msg-internal",  # внутреннее поле, наружу не отдаём
        }

        app = _build_app(conv_service=conv)

        fake_conn = AsyncMock()
        fake_adapter = MagicMock(get_table_name=lambda n: n)
        with patch(
            "app.db.connection.get_db", return_value=_make_db_ctx(fake_conn),
        ), patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ), patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository.get_active_for_conversation",
            new=AsyncMock(return_value=active_row),
        ):
            with TestClient(app) as client:
                resp = client.get(
                    "/api/v1/chat/conversations/conv-1/active-forward",
                )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["request_id"] == "agent-req-1"
        assert body["status"] == "in_progress"
        assert body["created_at"].startswith("2026-05-20T17:35:21")
        # message_id наружу не отдаётся
        assert "message_id" not in body

    def test_active_forward_returns_204_when_none(self):
        """Если активных forward'ов нет — 204 No Content."""
        settings = _make_settings()
        conv = _make_conv_service(settings)

        app = _build_app(conv_service=conv)
        fake_conn = AsyncMock()
        fake_adapter = MagicMock(get_table_name=lambda n: n)
        with patch(
            "app.db.connection.get_db", return_value=_make_db_ctx(fake_conn),
        ), patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ), patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository.get_active_for_conversation",
            new=AsyncMock(return_value=None),
        ):
            with TestClient(app) as client:
                resp = client.get(
                    "/api/v1/chat/conversations/conv-1/active-forward",
                )

        assert resp.status_code == 204
        assert resp.content == b""

    def test_active_forward_does_not_leak_other_users(self):
        """Беседа чужого пользователя → 404 (ownership-проверка в conv_service)."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        # Имитируем, что ConversationService отказал в доступе (чужая беседа).
        conv.get = AsyncMock(
            side_effect=ConversationNotFoundError("Беседа не найдена"),
        )

        app = _build_app(conv_service=conv)
        with TestClient(app) as client:
            resp = client.get(
                "/api/v1/chat/conversations/foreign-conv/active-forward",
            )

        assert resp.status_code == 404
        assert resp.json() == {"detail": "Беседа не найдена"}
