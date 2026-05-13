"""Тесты сервисов домена чата."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.file_service import FileService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Общие фикстуры
# -------------------------------------------------------------------------


@pytest.fixture
def settings():
    """Настройки чата с дефолтными значениями."""
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


# -------------------------------------------------------------------------
# ConversationService
# -------------------------------------------------------------------------


class TestConversationServiceCreate:

    @pytest.fixture
    def service(self, conv_repo, settings):
        return ConversationService(conv_repo=conv_repo, settings=settings)

    async def test_create_success(self, service, conv_repo):
        """Создание беседы при наличии свободного лимита."""
        conv_repo.count_by_user.return_value = 0
        conv_repo.create.return_value = {
            "id": "abc-123",
            "user_id": "user1",
            "title": "Тест",
        }

        result = await service.create(user_id="user1", title="Тест")

        assert result["title"] == "Тест"
        conv_repo.count_by_user.assert_called_once_with("user1")
        conv_repo.create.assert_called_once()

    async def test_create_exceeds_limit(self, service, conv_repo, settings):
        """Превышение лимита бесед вызывает HTTPException 422."""
        conv_repo.count_by_user.return_value = settings.max_conversations_per_user

        with pytest.raises(HTTPException) as exc_info:
            await service.create(user_id="user1")
        assert exc_info.value.status_code == 422
        assert "лимит" in exc_info.value.detail.lower()


class TestConversationServiceGet:

    @pytest.fixture
    def service(self, conv_repo, settings):
        return ConversationService(conv_repo=conv_repo, settings=settings)

    async def test_get_not_found(self, service, conv_repo):
        """Несуществующая беседа вызывает HTTPException 404."""
        conv_repo.get_by_id.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await service.get("nonexistent-id", "user1")
        assert exc_info.value.status_code == 404

    async def test_get_found(self, service, conv_repo):
        """Возвращает беседу при наличии."""
        conv_repo.get_by_id.return_value = {"id": "abc", "user_id": "user1"}

        result = await service.get("abc", "user1")
        assert result["id"] == "abc"


# -------------------------------------------------------------------------
# MessageService
# -------------------------------------------------------------------------


class TestMessageServiceSaveUser:

    @pytest.fixture
    def service(self, msg_repo, conv_repo, settings):
        return MessageService(
            msg_repo=msg_repo, conv_repo=conv_repo, settings=settings,
        )

    async def test_save_user_message(self, service, msg_repo, conv_repo):
        """Сохранение пользовательского сообщения."""
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": "Привет"}],
        }

        result = await service.save_user_message(
            conversation_id="conv-1",
            content="Привет",
            user_id="user1",
        )

        assert result["role"] == "user"
        msg_repo.create.assert_called_once()
        conv_repo.touch.assert_called_once_with("conv-1")

    async def test_save_exceeds_length_limit(self, service, msg_repo):
        """Слишком длинное сообщение вызывает HTTPException 422."""
        long_content = "A" * (service.settings.max_message_content_length + 1)

        with pytest.raises(HTTPException) as exc_info:
            await service.save_user_message(
                conversation_id="conv-1",
                content=long_content,
                user_id="user1",
            )
        assert exc_info.value.status_code == 422
        assert "длинное" in exc_info.value.detail.lower()

    async def test_save_exceeds_message_count_limit(self, service, msg_repo, settings):
        """Превышение лимита сообщений вызывает HTTPException 422."""
        msg_repo.count_by_conversation.return_value = settings.max_messages_per_conversation

        with pytest.raises(HTTPException) as exc_info:
            await service.save_user_message(
                conversation_id="conv-1",
                content="Текст",
                user_id="user1",
            )
        assert exc_info.value.status_code == 422
        assert "лимит" in exc_info.value.detail.lower()


class TestMessageServiceSaveAssistant:

    @pytest.fixture
    def service(self, msg_repo, conv_repo, settings):
        return MessageService(
            msg_repo=msg_repo, conv_repo=conv_repo, settings=settings,
        )

    async def test_save_assistant_message(self, service, msg_repo, conv_repo):
        """Сохранение сообщения ассистента."""
        msg_repo.create.return_value = {
            "id": "msg-2",
            "role": "assistant",
            "content": [{"type": "text", "content": "Ответ"}],
        }

        result = await service.save_assistant_message(
            conversation_id="conv-1",
            content=[{"type": "text", "content": "Ответ"}],
            model="gpt-4o",
        )

        assert result["role"] == "assistant"
        conv_repo.touch.assert_called_once_with("conv-1")


# -------------------------------------------------------------------------
# FileService
# -------------------------------------------------------------------------


class TestFileServiceValidate:

    @pytest.fixture
    def service(self, file_repo, conv_repo, settings):
        return FileService(
            file_repo=file_repo, conv_repo=conv_repo, settings=settings,
        )

    def test_validate_ok(self, service):
        """Валидный файл проходит проверку без ошибок."""
        service.validate_file(
            filename="report.pdf",
            mime_type="application/pdf",
            file_size=1024,
        )

    def test_validate_text_wildcard(self, service):
        """Текстовые типы проходят по шаблону text/*."""
        service.validate_file(
            filename="data.csv",
            mime_type="text/csv",
            file_size=100,
        )

    def test_validate_too_large(self, service, settings):
        """Слишком большой файл вызывает HTTPException 422."""
        with pytest.raises(HTTPException) as exc_info:
            service.validate_file(
                filename="huge.pdf",
                mime_type="application/pdf",
                file_size=settings.max_file_size + 1,
            )
        assert exc_info.value.status_code == 422
        assert "большой" in exc_info.value.detail.lower()

    def test_validate_wrong_mime_type(self, service):
        """Неподдерживаемый MIME-тип вызывает HTTPException 422."""
        with pytest.raises(HTTPException) as exc_info:
            service.validate_file(
                filename="malware.exe",
                mime_type="application/x-msdownload",
                file_size=100,
            )
        assert exc_info.value.status_code == 422
        assert "не поддерживается" in exc_info.value.detail.lower()


class TestFileServiceSave:

    @pytest.fixture
    def service(self, file_repo, conv_repo, settings):
        return FileService(
            file_repo=file_repo, conv_repo=conv_repo, settings=settings,
        )

    async def test_save_file_conversation_not_found(self, service, conv_repo):
        """Загрузка файла в несуществующую беседу вызывает 404."""
        conv_repo.get_by_id.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await service.save_file(
                conversation_id="nonexistent",
                user_id="user1",
                filename="test.pdf",
                mime_type="application/pdf",
                file_data=b"data",
            )
        assert exc_info.value.status_code == 404

    async def test_save_file_success(self, service, conv_repo, file_repo):
        """Успешное сохранение файла."""
        conv_repo.get_by_id.return_value = {"id": "conv-1", "user_id": "user1"}
        file_repo.create.return_value = {
            "id": "file-1",
            "filename": "test.pdf",
            "mime_type": "application/pdf",
            "file_size": 4,
        }

        result = await service.save_file(
            conversation_id="conv-1",
            user_id="user1",
            filename="test.pdf",
            mime_type="application/pdf",
            file_data=b"data",
        )

        assert result["id"] == "file-1"
        file_repo.create.assert_called_once()


class TestFileServiceGet:

    @pytest.fixture
    def service(self, file_repo, conv_repo, settings):
        return FileService(
            file_repo=file_repo, conv_repo=conv_repo, settings=settings,
        )

    async def test_get_file_not_found(self, service, file_repo):
        """Несуществующий файл вызывает HTTPException 404."""
        file_repo.get_file_data.return_value = None

        with pytest.raises(HTTPException) as exc_info:
            await service.get_file(file_id="nonexistent", user_id="user1")
        assert exc_info.value.status_code == 404

    async def test_get_file_found(self, service, file_repo):
        """Возвращает данные файла при наличии."""
        file_repo.get_file_data.return_value = {
            "id": "file-1",
            "filename": "test.pdf",
            "file_data": b"content",
        }

        result = await service.get_file(file_id="file-1", user_id="user1")
        assert result["filename"] == "test.pdf"
