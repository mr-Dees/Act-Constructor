"""E2E API-тесты эндпоинтов чата.

Покрывает маршрутизацию + статус-коды + ownership-проверки через
``TestClient(app)``. Полное приложение не поднимаем: собираем минимальный
``FastAPI`` с тремя chat-роутерами, переопределяем DI-зависимости
(``get_username``, ``get_user_roles``, сервисы) на моки и проверяем поведение.
"""

from __future__ import annotations

import datetime as dt
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.v1.deps.auth_deps import get_username
from app.api.v1.deps.role_deps import get_user_roles
from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.exceptions import AppError
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.api.conversations import router as conv_router
from app.domains.chat.api.files import router as files_router
from app.domains.chat.api.messages import router as msg_router
from app.domains.chat.deps import (
    get_conversation_service,
    get_file_service,
    get_message_service,
)
from app.domains.chat.exceptions import (
    ChatFileNotFoundError,
    ChatFileValidationError,
    ConversationNotFoundError,
)
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Сброс глобального состояния доменных реестров между тестами
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс реестров доменов/настроек/инструментов."""
    reset_registry()
    reset_settings()
    reset_tools()
    yield
    reset_registry()
    reset_settings()
    reset_tools()


# -------------------------------------------------------------------------
# Фабрика тестового приложения и моки сервисов
# -------------------------------------------------------------------------


USERNAME = "12345"


def _make_settings() -> ChatDomainSettings:
    """Настройки чата с пустым API — оркестратор уйдёт в fallback."""
    return ChatDomainSettings(api_base="", api_key="", model="gpt-4o")


def _build_app(
    *,
    conv_service: object,
    msg_service: object,
    file_service: object,
    username: str = USERNAME,
) -> FastAPI:
    """Собирает минимальный FastAPI с тремя chat-роутерами и оверрайдами DI."""
    app = FastAPI()

    # AppError-handler как в основном app/main.py
    @app.exception_handler(AppError)
    async def _app_err_handler(_request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_detail())

    # Подключаем три chat-роутера под /api/v1/chat
    app.include_router(conv_router, prefix="/api/v1/chat")
    app.include_router(msg_router, prefix="/api/v1/chat")
    app.include_router(files_router, prefix="/api/v1/chat")

    # Auth: get_username -> фиксированный пользователь
    app.dependency_overrides[get_username] = lambda: username
    # Роль: возвращаем Админа, чтобы require_domain_access('chat') пропустил
    app.dependency_overrides[get_user_roles] = lambda: [
        {"id": 1, "name": "Админ", "domain_name": None},
    ]
    # Сервисы — мокаем через DI
    app.dependency_overrides[get_conversation_service] = lambda: conv_service
    app.dependency_overrides[get_message_service] = lambda: msg_service
    app.dependency_overrides[get_file_service] = lambda: file_service

    return app


def _make_conv_service(settings: ChatDomainSettings) -> MagicMock:
    """Mock ConversationService с базовыми методами."""
    svc = MagicMock()
    svc.settings = settings
    svc.create = AsyncMock()
    svc.get = AsyncMock()
    svc.get_list = AsyncMock()
    svc.delete = AsyncMock()
    svc.update_title = AsyncMock()
    return svc


def _make_msg_service(settings: ChatDomainSettings) -> MagicMock:
    """Mock MessageService."""
    svc = MagicMock()
    svc.settings = settings
    svc.save_user_message = AsyncMock()
    svc.get_history = AsyncMock(return_value=[])
    return svc


def _make_file_service(settings: ChatDomainSettings) -> MagicMock:
    """Mock FileService."""
    svc = MagicMock()
    svc.settings = settings
    svc.save_file = AsyncMock()
    svc.get_file = AsyncMock()
    return svc


# -------------------------------------------------------------------------
# POST /api/v1/chat/conversations — создание беседы
# -------------------------------------------------------------------------


class TestCreateConversation:
    """E2E: создание беседы возвращает 201 и корректный schema-ответ."""

    def test_create_conversation_returns_201(self):
        """Успешное создание беседы возвращает 201 со схемой ConversationResponse."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        now = dt.datetime(2026, 5, 14, 12, 0, 0)
        conv.create.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": "Новая беседа",
            "domain_name": None,
            "context": None,
            "created_at": now,
            "updated_at": now,
        }

        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/chat/conversations",
                json={"title": "Новая беседа"},
            )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["id"] == "conv-1"
        # user_id из переопределённого get_username
        assert body["user_id"] == USERNAME
        assert body["title"] == "Новая беседа"

        # ConversationService.create вызван с user_id из get_username
        call = conv.create.await_args
        assert call.kwargs["user_id"] == USERNAME

    def test_create_conversation_unauthorized(self):
        """Отсутствие JUPYTERHUB_USER приводит к 401."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        # Имитируем неавторизованного: override бросает 401
        def _no_user() -> str:
            raise HTTPException(status_code=401, detail="Требуется авторизация")

        app.dependency_overrides[get_username] = _no_user

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/chat/conversations", json={"title": "X"},
            )

        assert resp.status_code == 401


# -------------------------------------------------------------------------
# GET /api/v1/chat/conversations — список бесед
# -------------------------------------------------------------------------


class TestListConversations:
    """E2E: список бесед возвращает массив ConversationListItem."""

    def test_list_conversations_returns_array(self):
        """GET возвращает список бесед текущего пользователя."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        now = dt.datetime(2026, 5, 14, 12, 0, 0)
        conv.get_list.return_value = [
            {
                "id": "c1",
                "title": "Первая",
                "domain_name": None,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": "c2",
                "title": "Вторая",
                "domain_name": "acts",
                "created_at": now,
                "updated_at": now,
            },
        ]

        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        with TestClient(app) as client:
            resp = client.get("/api/v1/chat/conversations")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == 2
        assert body[0]["id"] == "c1"
        assert body[1]["domain_name"] == "acts"
        # сервис вызывался с username
        assert conv.get_list.await_args.args[0] == USERNAME


# -------------------------------------------------------------------------
# DELETE /api/v1/chat/conversations/{id} — удаление + ownership
# -------------------------------------------------------------------------


class TestDeleteConversation:
    """E2E: удаление беседы + ownership-проверка."""

    def test_delete_own_conversation_returns_200(self):
        """Удаление своей беседы возвращает 200 и deleted=True."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.delete.return_value = True

        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        with TestClient(app) as client:
            resp = client.delete("/api/v1/chat/conversations/conv-1")

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"deleted": True}
        # сервис вызывается с username — это ownership-фильтр на уровне repo
        assert conv.delete.await_args.args == ("conv-1", USERNAME)

    def test_delete_foreign_conversation_returns_deleted_false(self):
        """Удаление чужой беседы: repo фильтрует по user_id и возвращает False."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.delete.return_value = False  # repo не нашёл по (id, user_id)

        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        with TestClient(app) as client:
            resp = client.delete("/api/v1/chat/conversations/foreign-id")

        # Текущее поведение: 200 + deleted=False (ownership через user_id-фильтр).
        # Чужая беседа неотличима от удалённой — это намеренно (information leak).
        assert resp.status_code == 200
        assert resp.json() == {"deleted": False}


# -------------------------------------------------------------------------
# POST /conversations/{id}/messages — SSE-стрим
# -------------------------------------------------------------------------


class TestSendMessageSSE:
    """E2E: SSE-стрим открывается и первые события корректны."""

    def test_sse_stream_returns_429_when_user_already_streaming(self):
        """1.8: Второй параллельный SSE от того же пользователя — 429.

        Имитируем «уже активный стрим» через предзаполнение
        ``_active_streams_per_user[username]``: per-user семафор должен
        вернуть 429 без открытия стрима.
        """
        from app.domains.chat.api import messages as messages_module

        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        msg.save_user_message.return_value = {
            "id": "m-1",
            "role": "user",
            "content": [],
        }
        file_svc = _make_file_service(settings)

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        # Предзаполняем счётчик — будто у user уже идёт SSE
        messages_module._active_streams_per_user[USERNAME] = 1
        try:
            with TestClient(app) as client:
                resp = client.post(
                    "/api/v1/chat/conversations/conv-1/messages",
                    data={"message": "Привет"},
                    headers={"Accept": "text/event-stream"},
                )
            assert resp.status_code == 429, resp.text
            body = resp.json()
            assert "активный стрим" in body["detail"].lower()
        finally:
            messages_module._active_streams_per_user.pop(USERNAME, None)

    def test_sse_stream_releases_semaphore_on_completion(self):
        """1.8: После корректного завершения стрима счётчик возвращается к 0."""
        from app.domains.chat.api import messages as messages_module

        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        msg.save_user_message.return_value = {
            "id": "m-1",
            "role": "user",
            "content": [],
        }
        msg.save_assistant_message = AsyncMock(
            return_value={"id": "m-2", "role": "assistant", "content": []},
        )
        file_svc = _make_file_service(settings)

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        messages_module._active_streams_per_user.pop(USERNAME, None)

        with patch(
            "app.domains.chat.services.orchestrator.get_domain_settings",
            return_value=settings,
        ):
            with TestClient(app) as client:
                with client.stream(
                    "POST",
                    "/api/v1/chat/conversations/conv-1/messages",
                    data={"message": "Привет"},
                    headers={"Accept": "text/event-stream"},
                ) as resp:
                    # Полностью читаем поток, чтобы finally сработал
                    for _ in resp.iter_lines():
                        pass

        # После завершения счётчика быть не должно
        assert USERNAME not in messages_module._active_streams_per_user

    def test_sse_stream_emits_message_start_and_block_events(self):
        """Стрим возвращает 200, content-type SSE и валидные первые события.

        Используем fallback-режим оркестратора (api_base/api_key пустые) —
        реальный LLM не вызывается, генерируются: message_start →
        block_start(text) → block_delta → block_end → message_end.
        """
        settings = _make_settings()
        conv = _make_conv_service(settings)
        # get(conversation_id, username) — для ownership-проверки в endpoint
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        msg.save_user_message.return_value = {
            "id": "m-1",
            "role": "user",
            "content": [{"type": "text", "content": "Привет"}],
        }
        # save_assistant_message нужен оркестратору в конце run_stream
        msg.save_assistant_message = AsyncMock(
            return_value={"id": "m-2", "role": "assistant", "content": []},
        )

        file_svc = _make_file_service(settings)

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        # Патчим settings_registry, чтобы Orchestrator подхватил пустые api_*
        with patch(
            "app.domains.chat.services.orchestrator.get_domain_settings",
            return_value=settings,
        ):
            with TestClient(app) as client:
                with client.stream(
                    "POST",
                    "/api/v1/chat/conversations/conv-1/messages",
                    data={"message": "Привет"},
                    headers={"Accept": "text/event-stream"},
                ) as resp:
                    assert resp.status_code == 200, resp.read()
                    assert "text/event-stream" in resp.headers["content-type"]
                    # Читаем первые ~10 строк потока
                    collected: list[str] = []
                    for line in resp.iter_lines():
                        collected.append(line)
                        if len(collected) >= 12:
                            break

        joined = "\n".join(collected)
        # Минимум: первое событие — message_start с conv-1
        assert "event: message_start" in joined
        assert "conv-1" in joined
        # Должен быть хотя бы один block_start или block_delta
        assert "event: block_" in joined


# -------------------------------------------------------------------------
# POST /api/v1/chat/conversations/{id}/messages — загрузка файла в сообщении
# -------------------------------------------------------------------------


class TestUploadFileInMessage:
    """E2E: загрузка файлов идёт через эндпоинт сообщений.

    Отдельного ``POST /chat/files`` в текущей реализации нет — файлы
    приходят как multipart-files к сообщению. Тестируем валидный путь
    и отказ на запрещённом MIME (``application/x-msdownload``).
    """

    def test_send_message_with_valid_file_returns_200(self):
        """Сообщение с валидным PDF-файлом проходит."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        msg.save_user_message.return_value = {
            "id": "m-1",
            "role": "user",
            "content": [],
        }
        msg.save_assistant_message = AsyncMock(
            return_value={"id": "m-2", "role": "assistant", "content": []},
        )

        file_svc = _make_file_service(settings)
        file_svc.save_file.return_value = {
            "id": "f-1",
            "filename": "doc.pdf",
            "mime_type": "application/pdf",
            "file_size": 100,
        }

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        with patch(
            "app.domains.chat.services.orchestrator.get_domain_settings",
            return_value=settings,
        ):
            with TestClient(app) as client:
                # JSON-режим, не SSE — без Accept: text/event-stream
                resp = client.post(
                    "/api/v1/chat/conversations/conv-1/messages",
                    data={"message": "вот файл"},
                    files=[
                        (
                            "files",
                            ("doc.pdf", b"%PDF-1.4 fake", "application/pdf"),
                        ),
                    ],
                )

        assert resp.status_code == 200, resp.text
        file_svc.save_file.assert_awaited_once()
        # MIME-тип передан в save_file
        kwargs = file_svc.save_file.await_args.kwargs
        assert kwargs["mime_type"] == "application/pdf"
        assert kwargs["filename"] == "doc.pdf"

    def test_send_message_with_invalid_mime_returns_422(self):
        """Файл с запрещённым MIME (.exe) возвращает 422 от ChatFileValidationError.

        ``FileService.save_file`` поднимает ``ChatFileValidationError``
        (status_code=422); глобальный handler конвертирует в JSON-ответ.
        """
        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        file_svc = _make_file_service(settings)
        file_svc.save_file.side_effect = ChatFileValidationError(
            "Тип файла 'application/x-msdownload' не поддерживается.",
        )

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/chat/conversations/conv-1/messages",
                data={"message": "вот вирус"},
                files=[
                    (
                        "files",
                        ("malware.exe", b"MZ\x90\x00", "application/x-msdownload"),
                    ),
                ],
            )

        assert resp.status_code == 422, resp.text
        assert "не поддерживается" in resp.json()["detail"]

    def test_send_message_rejects_excess_files(self):
        """Превышение ``max_files_per_message`` → 422 до save_file.

        Guard в messages.py:99 должен среагировать ДО чтения файлов и ДО
        save_user_message: иначе можно протащить >N файлов и переполнить
        storage.
        """
        settings = ChatDomainSettings(
            api_base="",
            api_key="",
            model="gpt-4o",
            max_files_per_message=2,
        )
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        file_svc = _make_file_service(settings)

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/chat/conversations/conv-1/messages",
                data={"message": "три файла"},
                files=[
                    ("files", ("a.pdf", b"%PDF-1", "application/pdf")),
                    ("files", ("b.pdf", b"%PDF-1", "application/pdf")),
                    ("files", ("c.pdf", b"%PDF-1", "application/pdf")),
                ],
            )

        assert resp.status_code == 422, resp.text
        assert "Слишком много файлов" in resp.json()["detail"]
        # save_file и save_user_message НЕ должны быть вызваны
        file_svc.save_file.assert_not_awaited()
        msg.save_user_message.assert_not_awaited()

    def test_send_message_rejects_excess_total_size(self):
        """Превышение суммарного размера файлов → 422 до save_file.

        Guard в messages.py:113 должен среагировать после чтения всех
        файлов, но ДО save_file: иначе можно растянуть storage до OOM.
        """
        settings = ChatDomainSettings(
            api_base="",
            api_key="",
            model="gpt-4o",
            max_files_per_message=5,
            max_total_file_size=100,  # 100 байт — крошечный лимит
        )
        conv = _make_conv_service(settings)
        conv.get.return_value = {
            "id": "conv-1",
            "user_id": USERNAME,
            "title": None,
            "domain_name": None,
            "context": None,
        }
        msg = _make_msg_service(settings)
        file_svc = _make_file_service(settings)

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        big = b"x" * 200  # одного файла достаточно для превышения 100Б
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/chat/conversations/conv-1/messages",
                data={"message": "тяжёлый"},
                files=[
                    ("files", ("big.pdf", big, "application/pdf")),
                ],
            )

        assert resp.status_code == 422, resp.text
        assert "Суммарный размер" in resp.json()["detail"]
        file_svc.save_file.assert_not_awaited()
        msg.save_user_message.assert_not_awaited()


# -------------------------------------------------------------------------
# GET /api/v1/chat/files/{file_id} — скачивание файла
# -------------------------------------------------------------------------


class TestDownloadFile:
    """E2E: скачивание файла отдаёт правильные заголовки безопасности."""

    def test_download_file_returns_safe_headers(self):
        """Скачивание: 200 + Content-Disposition + nosniff + octet-stream."""
        settings = _make_settings()
        conv = _make_conv_service(settings)
        msg = _make_msg_service(settings)
        file_svc = _make_file_service(settings)
        file_svc.get_file.return_value = {
            "filename": "отчёт.pdf",  # с кириллицей — проверим UTF-8 encoding
            "mime_type": "application/pdf",
            "file_data": b"%PDF-1.4 binary content",
        }

        app = _build_app(
            conv_service=conv,
            msg_service=msg,
            file_service=file_svc,
        )

        with TestClient(app) as client:
            resp = client.get("/api/v1/chat/files/file-123")

        assert resp.status_code == 200, resp.text
        # Принудительный application/octet-stream — не доверяем сохранённому MIME
        assert resp.headers["content-type"] == "application/octet-stream"
        # nosniff — блокирует MIME-sniffing в браузере
        assert resp.headers["x-content-type-options"] == "nosniff"
        # Content-Disposition с filename* UTF-8 encoded
        cd = resp.headers["content-disposition"]
        assert cd.startswith("attachment;")
        assert "filename*=UTF-8''" in cd

        # Содержимое отдано как есть
        assert resp.content == b"%PDF-1.4 binary content"

    def test_download_unknown_file_returns_404(self):
        """Несуществующий файл возвращает 404 (ChatFileNotFoundError)."""
        settings = _make_settings()
        file_svc = _make_file_service(settings)
        file_svc.get_file.side_effect = ChatFileNotFoundError("Файл не найден")

        app = _build_app(
            conv_service=_make_conv_service(settings),
            msg_service=_make_msg_service(settings),
            file_service=file_svc,
        )

        with TestClient(app) as client:
            resp = client.get("/api/v1/chat/files/missing")

        assert resp.status_code == 404, resp.text
        assert resp.json() == {"detail": "Файл не найден"}


# -------------------------------------------------------------------------
# GET /api/v1/chat/conversations/{id} — ownership-check
# -------------------------------------------------------------------------


class TestConversationOwnership:
    """Чужая беседа: ConversationService.get -> 404 ConversationNotFoundError."""

    def test_get_foreign_conversation_returns_404(self):
        settings = _make_settings()
        conv = _make_conv_service(settings)
        conv.get.side_effect = ConversationNotFoundError("Беседа не найдена")

        app = _build_app(
            conv_service=conv,
            msg_service=_make_msg_service(settings),
            file_service=_make_file_service(settings),
        )

        with TestClient(app) as client:
            resp = client.get("/api/v1/chat/conversations/foreign-id")

        assert resp.status_code == 404
        assert resp.json() == {"detail": "Беседа не найдена"}
