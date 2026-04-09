"""Тесты безопасности домена чата.

Покрывает: инъекцию параметров в action handlers, обход проверки владельца,
валидацию входных данных, ограничения размеров.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from app.core.chat.buttons import register_action_handler, reset_action_handlers
from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.exceptions import (
    ActionNotFoundError,
    ChatFileNotFoundError,
    ChatFileValidationError,
    ChatLimitError,
    ConversationNotFoundError,
)
from app.domains.chat.schemas.requests import (
    CreateConversationRequest,
    UpdateConversationRequest,
)
from app.domains.chat.services.action_service import ActionService
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс глобального состояния реестров между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    reset_action_handlers()
    yield
    reset_registry()
    reset_settings()
    reset_tools()
    reset_action_handlers()


@pytest.fixture
def settings():
    """Настройки чата с дефолтами."""
    return ChatDomainSettings()


@pytest.fixture
def conv_repo():
    """Mock ConversationRepository."""
    return AsyncMock()


@pytest.fixture
def msg_repo():
    """Mock MessageRepository."""
    return AsyncMock()


@pytest.fixture
def file_repo():
    """Mock FileRepository."""
    return AsyncMock()


@pytest.fixture
def conv_service(conv_repo, settings):
    """ConversationService с mock-зависимостями."""
    return ConversationService(conv_repo=conv_repo, settings=settings)


@pytest.fixture
def msg_service(msg_repo, conv_repo, settings):
    """MessageService с mock-зависимостями."""
    return MessageService(msg_repo=msg_repo, conv_repo=conv_repo, settings=settings)


@pytest.fixture
def file_service(file_repo, conv_repo, settings):
    """FileService с mock-зависимостями."""
    return FileService(file_repo=file_repo, conv_repo=conv_repo, settings=settings)


# -------------------------------------------------------------------------
# BUG #2: Action handler kwargs injection
# -------------------------------------------------------------------------


class TestActionKwargsInjection:
    """BUG: params из запроса распаковываются как **kwargs в handler,
    что позволяет клиенту подменить user_id и conversation_id.
    """

    async def test_user_id_in_params_causes_crash(self):
        """BUG: user_id в params вызывает TypeError вместо корректной обработки.

        ActionService вызывает handler(user_id=user_id, **(params or {})),
        и если params содержит 'user_id', Python выбрасывает TypeError
        'got multiple values for keyword argument'. Это приводит к 500-ошибке
        вместо корректного отклонения или санитизации параметров.
        """
        async def handler(**kwargs):
            return {"status": "ok"}

        register_action_handler(
            action_id="test_action",
            domain="test",
            handler=handler,
            label="Тест",
        )

        service = ActionService()
        # Клиент передаёт user_id в params — вызывает необработанный TypeError
        with pytest.raises(TypeError, match="multiple values"):
            await service.execute(
                action_id="test_action",
                params={"user_id": "admin_user"},
                user_id="regular_user",
                conversation_id="conv-1",
            )

    async def test_conversation_id_in_params_causes_crash(self):
        """BUG: conversation_id в params вызывает TypeError."""
        async def handler(**kwargs):
            return {"status": "ok"}

        register_action_handler(
            action_id="test_action_2",
            domain="test",
            handler=handler,
            label="Тест 2",
        )

        service = ActionService()
        with pytest.raises(TypeError, match="multiple values"):
            await service.execute(
                action_id="test_action_2",
                params={"conversation_id": "other-conv"},
                user_id="user1",
                conversation_id="conv-1",
            )

    async def test_arbitrary_params_passed_to_handler(self):
        """Произвольные params передаются в handler без санитизации.

        Клиент может передать любые kwargs, которые будут переданы в handler.
        Если handler имеет побочные эффекты, это может быть опасно.
        """
        captured_kwargs = {}

        async def handler(**kwargs):
            captured_kwargs.update(kwargs)
            return {"status": "ok"}

        register_action_handler(
            action_id="test_action_3",
            domain="test",
            handler=handler,
            label="Тест 3",
        )

        service = ActionService()
        await service.execute(
            action_id="test_action_3",
            params={"admin_mode": True, "delete_all": True},
            user_id="user1",
        )

        # Произвольные params проходят без фильтрации
        assert captured_kwargs["admin_mode"] is True
        assert captured_kwargs["delete_all"] is True

    async def test_action_not_found(self):
        """Несуществующее действие вызывает ActionNotFoundError."""
        service = ActionService()
        with pytest.raises(ActionNotFoundError):
            await service.execute(
                action_id="nonexistent",
                user_id="user1",
            )


# -------------------------------------------------------------------------
# Проверки доступа к беседам — wrong user
# -------------------------------------------------------------------------


class TestConversationAccessControl:

    async def test_get_conversation_wrong_user(self, conv_service, conv_repo):
        """Получение чужой беседы возвращает 404."""
        conv_repo.get_by_id.return_value = None  # repo фильтрует по user_id

        with pytest.raises(ConversationNotFoundError):
            await conv_service.get("conv-1", "wrong_user")

    async def test_delete_conversation_wrong_user(self, conv_service, conv_repo):
        """Удаление чужой беседы — repo фильтрует по user_id."""
        conv_repo.delete.return_value = False  # ничего не удалено

        result = await conv_service.delete("conv-1", "wrong_user")
        assert result is False

    async def test_update_title_wrong_user(self, conv_service, conv_repo):
        """Обновление заголовка чужой беседы не срабатывает."""
        conv_repo.update_title.return_value = False

        result = await conv_service.update_title("conv-1", "wrong_user", "Новый")
        assert result is False


# -------------------------------------------------------------------------
# Проверки доступа к сообщениям
# -------------------------------------------------------------------------


class TestMessageAccessControl:

    async def test_save_message_no_ownership_check_on_conversation(
        self, msg_service, msg_repo, conv_repo,
    ):
        """save_user_message не проверяет принадлежность беседы пользователю.

        Вызывающий код (эндпоинт) должен проверить доступ через conv_service.get().
        Сервис сообщений полагается на внешнюю проверку.
        """
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": "Тест"}],
        }

        # Сервис НЕ проверяет, принадлежит ли conv-1 пользователю user1
        result = await msg_service.save_user_message(
            conversation_id="conv-1",
            content="Тест",
            user_id="user1",
        )
        assert result is not None

    async def test_empty_message_not_rejected_by_service(self, msg_service, msg_repo):
        """Пустое сообщение не проверяется на уровне сервиса."""
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": ""}],
        }

        # Пустая строка проходит проверку длины (0 < max_length)
        result = await msg_service.save_user_message(
            conversation_id="conv-1",
            content="",
            user_id="user1",
        )
        assert result is not None

    async def test_whitespace_only_message_not_rejected(self, msg_service, msg_repo):
        """Сообщение из одних пробелов не отклоняется сервисом."""
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": "   "}],
        }

        result = await msg_service.save_user_message(
            conversation_id="conv-1",
            content="   ",
            user_id="user1",
        )
        assert result is not None


# -------------------------------------------------------------------------
# Проверки доступа к файлам
# -------------------------------------------------------------------------


class TestFileAccessControl:

    async def test_get_file_wrong_user(self, file_service, file_repo):
        """Получение чужого файла возвращает 404."""
        file_repo.get_file_data.return_value = None

        with pytest.raises(ChatFileNotFoundError):
            await file_service.get_file(file_id="file-1", user_id="wrong_user")

    async def test_save_file_wrong_conversation_user(
        self, file_service, conv_repo,
    ):
        """Загрузка файла в чужую беседу отклоняется."""
        conv_repo.get_by_id.return_value = None  # беседа не принадлежит user

        with pytest.raises(ConversationNotFoundError):
            await file_service.save_file(
                conversation_id="conv-1",
                user_id="wrong_user",
                filename="test.pdf",
                mime_type="application/pdf",
                file_data=b"data",
            )


# -------------------------------------------------------------------------
# BUG #3: Отсутствие проверки доступа к домену на эндпоинтах
# -------------------------------------------------------------------------


class TestDomainAccessControl:
    """BUG: Эндпоинты чата не используют require_domain_access('chat').
    Любой авторизованный пользователь может использовать чат.
    """

    def test_no_domain_access_dependency_on_conversations_endpoint(self):
        """Проверка что роутер бесед не содержит зависимости require_domain_access."""
        from app.domains.chat.api.conversations import router

        # Проверяем зависимости роутов
        for route in router.routes:
            deps = getattr(route, "dependencies", [])
            dep_names = [
                getattr(d.dependency, "__name__", "")
                for d in deps
                if hasattr(d, "dependency")
            ]
            assert "require_domain_access" not in str(dep_names), (
                "BUG: require_domain_access должен быть добавлен, но его нет"
            )

    def test_no_domain_access_dependency_on_messages_endpoint(self):
        """Проверка что роутер сообщений не содержит зависимости require_domain_access."""
        from app.domains.chat.api.messages import router

        for route in router.routes:
            deps = getattr(route, "dependencies", [])
            dep_names = [
                getattr(d.dependency, "__name__", "")
                for d in deps
                if hasattr(d, "dependency")
            ]
            assert "require_domain_access" not in str(dep_names)


# -------------------------------------------------------------------------
# Валидация входных данных — схемы Pydantic
# -------------------------------------------------------------------------


class TestInputValidation:

    def test_update_title_empty_rejected(self):
        """Пустой заголовок отклоняется схемой."""
        with pytest.raises(ValidationError) as exc_info:
            UpdateConversationRequest(title="")
        assert "min_length" in str(exc_info.value).lower() or \
               "at least 1" in str(exc_info.value).lower() or \
               "string_too_short" in str(exc_info.value).lower()

    def test_update_title_too_long_rejected(self):
        """Слишком длинный заголовок отклоняется схемой."""
        with pytest.raises(ValidationError):
            UpdateConversationRequest(title="A" * 501)

    def test_update_title_valid(self):
        """Валидный заголовок проходит проверку."""
        req = UpdateConversationRequest(title="Нормальный заголовок")
        assert req.title == "Нормальный заголовок"

    def test_create_conversation_no_title_validation(self):
        """Создание беседы не ограничивает длину заголовка.

        BUG: CreateConversationRequest не имеет max_length для title,
        в отличие от UpdateConversationRequest.
        """
        # Очень длинный заголовок при создании — проходит
        req = CreateConversationRequest(title="A" * 10000)
        assert len(req.title) == 10000

    def test_create_conversation_context_accepts_any_dict(self):
        """BUG #13: context принимает произвольный JSONB без ограничения размера."""
        # Огромный context — проходит валидацию Pydantic
        large_context = {f"key_{i}": "x" * 1000 for i in range(1000)}
        req = CreateConversationRequest(context=large_context)
        assert len(req.context) == 1000

    def test_create_conversation_accepts_arbitrary_domain_name(self):
        """CreateConversationRequest принимает произвольные имена доменов.

        Нет валидации domain_name против списка зарегистрированных доменов.
        """
        # Произвольное имя домена проходит Pydantic-валидацию
        req = CreateConversationRequest(domain_name="../../etc/passwd")
        assert req.domain_name == "../../etc/passwd"

        req2 = CreateConversationRequest(domain_name="malicious_domain")
        assert req2.domain_name == "malicious_domain"


# -------------------------------------------------------------------------
# Валидация файлов
# -------------------------------------------------------------------------


class TestFileValidation:

    def test_validate_executable_rejected(self, file_service):
        """Исполняемые файлы отклоняются."""
        with pytest.raises(ChatFileValidationError) as exc_info:
            file_service.validate_file(
                filename="malware.exe",
                mime_type="application/x-msdownload",
                file_size=100,
            )
        assert "не поддерживается" in exc_info.value.message.lower()

    def test_validate_zip_rejected(self, file_service):
        """ZIP-архивы отклоняются."""
        with pytest.raises(ChatFileValidationError):
            file_service.validate_file(
                filename="archive.zip",
                mime_type="application/zip",
                file_size=100,
            )

    def test_validate_oversized_file(self, file_service, settings):
        """Файл больше лимита отклоняется."""
        with pytest.raises(ChatFileValidationError) as exc_info:
            file_service.validate_file(
                filename="huge.pdf",
                mime_type="application/pdf",
                file_size=settings.max_file_size + 1,
            )
        assert "большой" in exc_info.value.message.lower()

    def test_validate_exactly_max_size(self, file_service, settings):
        """Файл ровно на лимите проходит валидацию."""
        # Не должен выбросить исключение
        file_service.validate_file(
            filename="exact.pdf",
            mime_type="application/pdf",
            file_size=settings.max_file_size,
        )

    def test_validate_zero_size_file(self, file_service):
        """Файл нулевого размера проходит валидацию.

        BUG #12: Нет DB-level constraint на file_size.
        """
        file_service.validate_file(
            filename="empty.txt",
            mime_type="text/plain",
            file_size=0,
        )

    def test_validate_negative_size_not_caught(self, file_service):
        """Отрицательный размер файла проходит валидацию.

        BUG #12: Нет проверки file_size > 0 ни на уровне сервиса, ни БД.
        """
        # Отрицательный размер проходит (0 < max_file_size — True)
        file_service.validate_file(
            filename="negative.txt",
            mime_type="text/plain",
            file_size=-1,
        )


# -------------------------------------------------------------------------
# Лимиты сообщений
# -------------------------------------------------------------------------


class TestMessageLimits:

    async def test_message_too_long(self, msg_service, settings):
        """Сообщение длиннее max_message_content_length отклоняется."""
        long_content = "A" * (settings.max_message_content_length + 1)

        with pytest.raises(ChatLimitError) as exc_info:
            await msg_service.save_user_message(
                conversation_id="conv-1",
                content=long_content,
                user_id="user1",
            )
        assert "длинное" in exc_info.value.message.lower()

    async def test_message_exactly_max_length(self, msg_service, msg_repo, settings):
        """Сообщение ровно на лимите проходит."""
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": "x"}],
        }

        exact_content = "A" * settings.max_message_content_length
        # Не должен выбросить
        await msg_service.save_user_message(
            conversation_id="conv-1",
            content=exact_content,
            user_id="user1",
        )

    async def test_message_count_limit(self, msg_service, msg_repo, settings):
        """Превышение лимита сообщений в беседе отклоняется."""
        msg_repo.count_by_conversation.return_value = settings.max_messages_per_conversation

        with pytest.raises(ChatLimitError) as exc_info:
            await msg_service.save_user_message(
                conversation_id="conv-1",
                content="Тест",
                user_id="user1",
            )
        assert "лимит" in exc_info.value.message.lower()

    async def test_conversation_count_limit(self, conv_service, conv_repo, settings):
        """Превышение лимита бесед отклоняется."""
        conv_repo.count_by_user.return_value = settings.max_conversations_per_user

        with pytest.raises(ChatLimitError) as exc_info:
            await conv_service.create(user_id="user1")
        assert "лимит" in exc_info.value.message.lower()


# -------------------------------------------------------------------------
# BUG #5: Оркестратор обходит абстракцию репозитория
# -------------------------------------------------------------------------


class TestOrchestratorBypassesRepository:
    """BUG: _build_user_content использует прямой SQL вместо FileRepository.get_file_data.

    Это пропускает проверку ownership (JOIN с conversations + WHERE user_id).
    """

    async def test_direct_sql_without_user_check(self):
        """Прямой SQL в _build_user_content не проверяет user_id."""
        from app.domains.chat.services.orchestrator import Orchestrator

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={
            "filename": "target.pdf",
            "mime_type": "text/plain",
            "file_data": b"File content data",
        })
        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)

        mock_adapter = MagicMock(get_table_name=lambda n: n)

        settings = ChatDomainSettings()
        orchestrator = Orchestrator(
            msg_service=AsyncMock(),
            conv_service=AsyncMock(),
            settings=settings,
        )

        with (
            patch("app.db.connection.get_db", return_value=ctx),
            patch("app.db.connection.get_adapter", return_value=mock_adapter),
            patch("app.db.repositories.base.get_adapter", return_value=mock_adapter),
        ):
            result = await orchestrator._build_user_content(
                "Запрос", [{"file_id": "any-file-id"}],
            )

        # Проверяем SQL — он НЕ содержит user_id в условии
        sql_call = mock_conn.fetchrow.call_args[0][0]
        assert "user_id" not in sql_call
        # Контент файла получен без проверки владельца
        assert "target.pdf" in result
