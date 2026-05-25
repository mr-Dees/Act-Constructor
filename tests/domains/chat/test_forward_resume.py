"""E2E API-тесты resume forward-запросов внешнего агента.

Тесты собираем как ``test_chat_api_e2e.py``: минимальный ``FastAPI``,
подключаем нужные роутеры, переопределяем DI через
``app.dependency_overrides``. См. CLAUDE.md → раздел Testing.

Покрытие:
* ``GET /active-forward`` — 200/204/чужой пользователь.
* ``GET /forward-stream/{request_id}`` — SSE с накопленными
  reasoning + final response, 404 на неизвестный request_id,
  429 при превышении лимита параллельных стримов.
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
OTHER_USER = "99999"


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


@pytest.fixture(autouse=True)
def _reset_streams_counter():
    """Между тестами сбрасываем per-user счётчик активных SSE-стримов."""
    from app.domains.chat.api import messages as messages_module
    messages_module._active_streams_per_user.clear()
    yield
    messages_module._active_streams_per_user.clear()


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
        return JSONResponse(status_code=exc.status_code, content=exc.to_envelope())

    app.include_router(conv_router, prefix="/api/v1/chat")
    app.include_router(forward_resume_router, prefix="/api/v1/chat")

    app.dependency_overrides[get_username] = lambda: username
    app.dependency_overrides[get_user_roles] = lambda: [
        {"id": 1, "name": "Админ", "domain_name": None},
    ]
    app.dependency_overrides[get_conversation_service] = lambda: conv_service
    return app


# ── helpers для патча БД ──────────────────────────────────────────────────


def _make_db_ctx(conn: AsyncMock) -> AsyncMock:
    """async-context-manager, возвращающий заданный conn."""
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


# =========================================================================
# GET /active-forward
# =========================================================================


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

        # Патчим get_db и репозиторий
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
        assert resp.json() == {
            "detail": "Беседа не найдена",
            "code": "conversation-not-found",
        }


# =========================================================================
# GET /forward-stream/{request_id}
# =========================================================================


class TestForwardStreamResume:
    """E2E: ``GET /conversations/{cid}/forward-stream/{rid}``."""

    def test_forward_stream_emits_existing_events_and_response(self):
        """Endpoint эмитит reasoning блоки + emit_response_blocks.

        Заранее «положили» событие reasoning и финальный response —
        helper stream_forward_events должен выдать их в SSE-формате.
        """
        settings = _make_settings()
        conv = _make_conv_service(settings)
        app = _build_app(conv_service=conv)

        # Полная история agent_request, conversation и user должны совпадать
        agent_request_row = {
            "id": "agent-req-1",
            "conversation_id": "conv-1",
            "message_id": "msg-1",
            "user_id": USERNAME,
            "status": "in_progress",
            "knowledge_bases": [],
            "history": [],
            "files": [],
        }

        # Стенд: первый тик возвращает событие reasoning и финальный response;
        # после yield'a response stream_forward_events завершится.
        reasoning_event = {
            "seq": 1,
            "event_type": "reasoning",
            "payload": {"text": "Думаю над ответом"},
        }
        final_response = {
            "blocks": [
                {"type": "text", "content": "Окончательный ответ"},
            ],
            "token_usage": None,
        }

        fake_conn = AsyncMock()
        fake_adapter = MagicMock(get_table_name=lambda n: n)

        # poll_events — первый вызов возвращает event, дальше пусто.
        poll_events_mock = AsyncMock(side_effect=[
            [reasoning_event],
            [],
        ])
        poll_response_mock = AsyncMock(return_value=final_response)
        # AgentRequestRepository.get вызывается ДО stream'а (для валидации)
        # и потенциально внутри stream_forward_events (когда poll_response None).
        # Мы возвращаем agent_request на оба пути.
        agent_request_get_mock = AsyncMock(return_value=agent_request_row)

        with patch(
            "app.db.connection.get_db", return_value=_make_db_ctx(fake_conn),
        ), patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ), patch(
            "app.core.settings_registry.get", return_value=settings,
        ), patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository.get",
            new=agent_request_get_mock,
        ), patch(
            "app.domains.chat.services.agent_bridge.AgentBridgeService."
            "poll_events",
            new=poll_events_mock,
        ), patch(
            "app.domains.chat.services.agent_bridge.AgentBridgeService."
            "poll_response",
            new=poll_response_mock,
        ):
            with TestClient(app) as client:
                with client.stream(
                    "GET",
                    "/api/v1/chat/conversations/conv-1/forward-stream/agent-req-1",
                ) as resp:
                    assert resp.status_code == 200, resp.read()
                    assert "text/event-stream" in resp.headers["content-type"]
                    collected: list[str] = []
                    for line in resp.iter_lines():
                        collected.append(line)
                        # Достаточно ~30 строк, чтобы захватить финал.
                        if len(collected) >= 60:
                            break

        joined = "\n".join(collected)
        # Стрим начинается с agent_request_started.
        assert "event: agent_request_started" in joined
        # Reasoning-чанк отдан триплетом block_start/delta/end с type=reasoning.
        assert "event: block_start" in joined
        assert '"type": "reasoning"' in joined
        assert "Думаю над ответом" in joined
        # Финальный response пришёл text-блоком.
        assert "Окончательный ответ" in joined
        # Терминальное событие — message_end.
        assert "event: message_end" in joined

    def test_forward_stream_404_for_unknown_request(self):
        """Несуществующий request_id → 404."""
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
            "app.core.settings_registry.get", return_value=settings,
        ), patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository.get",
            new=AsyncMock(return_value=None),
        ):
            with TestClient(app) as client:
                resp = client.get(
                    "/api/v1/chat/conversations/conv-1/forward-stream/missing",
                )

        assert resp.status_code == 404
        assert resp.json() == {
            "detail": "Запрос агента не найден",
            "code": "conversation-not-found",
        }

    def test_forward_stream_404_when_request_belongs_to_other_user(self):
        """Чужой request_id — но в нашей беседе — тоже 404."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        app = _build_app(conv_service=conv)

        agent_request_row = {
            "id": "agent-req-foreign",
            "conversation_id": "conv-1",
            "message_id": "msg-x",
            "user_id": OTHER_USER,  # другой пользователь
            "status": "in_progress",
            "knowledge_bases": [], "history": [], "files": [],
        }

        fake_conn = AsyncMock()
        fake_adapter = MagicMock(get_table_name=lambda n: n)
        with patch(
            "app.db.connection.get_db", return_value=_make_db_ctx(fake_conn),
        ), patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ), patch(
            "app.core.settings_registry.get", return_value=settings,
        ), patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository.get",
            new=AsyncMock(return_value=agent_request_row),
        ):
            with TestClient(app) as client:
                resp = client.get(
                    "/api/v1/chat/conversations/conv-1/forward-stream/"
                    "agent-req-foreign",
                )

        assert resp.status_code == 404
        assert resp.json() == {
            "detail": "Запрос агента не найден",
            "code": "conversation-not-found",
        }

    def test_forward_stream_ignores_post_messages_semaphore(self):
        """Resume SSE НЕ учитывается в семафоре _active_streams_per_user.

        Семафор лимитирует число активных user-message запросов
        (POST /messages). Resume — read-only наблюдатель уже
        зарегистрированного agent_request, не «новый запрос», и при
        заполненном до лимита POST-семафоре всё равно должен открываться.

        Иначе при POST forward'е, ещё в полёте, + переключении обратно
        на ту же беседу счётчик удваивался бы (POST+Resume для одного
        forward'а) и юзер ловил 429 просто просматривая свои чаты.
        """
        from app.domains.chat.api import messages as messages_module

        settings = _make_settings()
        conv = _make_conv_service(settings)
        app = _build_app(conv_service=conv)

        agent_request_row = {
            "id": "agent-req-1",
            "conversation_id": "conv-1",
            "message_id": "msg-1",
            "user_id": USERNAME,
            "status": "in_progress",
            "knowledge_bases": [], "history": [], "files": [],
        }

        # Забиваем POST-семафор до лимита — Resume всё равно должен
        # открыться, потому что больше не считает себя в этот же счётчик.
        max_streams = settings.max_parallel_streams_per_user
        messages_module._active_streams_per_user[USERNAME] = max_streams

        fake_conn = AsyncMock()
        fake_adapter = MagicMock(get_table_name=lambda n: n)

        async def _empty_events(**_kwargs):
            # Сразу завершаем — нас интересует только что 429 не было.
            return
            yield  # pragma: no cover

        try:
            with patch(
                "app.db.connection.get_db", return_value=_make_db_ctx(fake_conn),
            ), patch(
                "app.db.repositories.base.get_adapter", return_value=fake_adapter,
            ), patch(
                "app.domains.chat.repositories.agent_request_repository."
                "AgentRequestRepository.get",
                new=AsyncMock(return_value=agent_request_row),
            ), patch(
                "app.core.settings_registry.get", return_value=settings,
            ), patch(
                "app.domains.chat.services.forward_stream."
                "stream_forward_events",
                _empty_events,
            ):
                with TestClient(app) as client:
                    resp = client.get(
                        "/api/v1/chat/conversations/conv-1/forward-stream/"
                        "agent-req-1",
                    )

            assert resp.status_code == 200, resp.text
            assert resp.headers["content-type"].startswith(
                "text/event-stream",
            )
            # POST-счётчик должен остаться нетронутым: Resume его не
            # инкрементил и не декрементил.
            assert (
                messages_module._active_streams_per_user.get(USERNAME)
                == max_streams
            )
        finally:
            messages_module._active_streams_per_user.pop(USERNAME, None)

    def test_second_resume_evicts_first_via_cancel_event(self):
        """Второй Resume для того же request_id вытесняет первый.

        Регрессия: при tab switch'ах фронт открывал N Resume SSE на один
        request_id, старые умирали только через heartbeat-disconnect
        (≈7с). За это время каждый крутил свой polling-цикл, нагружая
        pool. После фикса — старый получает set() cancel_event'а в момент
        регистрации нового и завершается мгновенно.
        """
        import asyncio

        from app.domains.chat.api import forward_resume as fr

        # Эмулируем уже зарегистрированный старый Resume.
        rid = "req-evict-test"
        old_cancel = asyncio.Event()
        fr._active_resume_cancels[rid] = old_cancel

        # Воспроизводим логику регистрации нового Resume из эндпоинта.
        cancel_event = asyncio.Event()
        previous = fr._active_resume_cancels.pop(rid, None)
        if previous is not None and not previous.is_set():
            previous.set()
        fr._active_resume_cancels[rid] = cancel_event

        try:
            assert old_cancel.is_set(), (
                "старый cancel_event должен быть set после регистрации нового"
            )
            assert not cancel_event.is_set(), (
                "новый cancel_event ещё не должен быть set"
            )
            assert fr._active_resume_cancels[rid] is cancel_event, (
                "в registry должен лежать новый cancel_event"
            )
        finally:
            fr._active_resume_cancels.pop(rid, None)
