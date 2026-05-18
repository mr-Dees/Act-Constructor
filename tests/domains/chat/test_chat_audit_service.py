"""Тесты ChatAuditService — фасада записи audit-лога чата."""

from unittest.mock import AsyncMock

import pytest

from app.core.chat.names import (
    AUDIT_CONVERSATION_CREATED,
    AUDIT_CONVERSATION_DELETED,
    AUDIT_FILE_DELETED,
    AUDIT_FILE_UPLOADED,
    AUDIT_MESSAGE_SENT,
    AUDIT_STREAM_ABORTED,
    AUDIT_STREAM_COMPLETED,
    AUDIT_STREAM_STARTED,
)
from app.domains.chat.services.chat_audit_service import ChatAuditService


@pytest.fixture
def repo():
    """Mock ChatAuditLogRepository с явно async-замоканным log()."""
    r = AsyncMock()
    r.log = AsyncMock()
    return r


@pytest.fixture
def service(repo):
    return ChatAuditService(repo=repo)


async def test_log_conversation_created_passes_title_and_domain(service, repo):
    await service.log_conversation_created(
        username="user1",
        conversation_id="conv-1",
        title="Беседа 1",
        domain_name="acts",
    )
    repo.log.assert_awaited_once()
    kwargs = repo.log.call_args.kwargs
    assert kwargs["username"] == "user1"
    assert kwargs["action"] == AUDIT_CONVERSATION_CREATED
    assert kwargs["conversation_id"] == "conv-1"
    assert kwargs["details"] == {"title": "Беседа 1", "domain_name": "acts"}


async def test_log_conversation_created_without_optional_fields(service, repo):
    """Без title/domain_name details=None — пустой dict не пишем."""
    await service.log_conversation_created(
        username="user1",
        conversation_id="conv-1",
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["details"] is None


async def test_log_conversation_deleted(service, repo):
    await service.log_conversation_deleted(
        username="user1",
        conversation_id="conv-1",
    )
    repo.log.assert_awaited_once()
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_CONVERSATION_DELETED
    assert kwargs["conversation_id"] == "conv-1"
    assert kwargs["details"] is None


async def test_log_message_sent_passes_details(service, repo):
    await service.log_message_sent(
        username="user1",
        conversation_id="conv-1",
        message_id="m-1",
        content_length=42,
        files_count=2,
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_MESSAGE_SENT
    assert kwargs["details"] == {
        "message_id": "m-1",
        "content_length": 42,
        "files_count": 2,
    }


async def test_log_file_uploaded(service, repo):
    await service.log_file_uploaded(
        username="user1",
        conversation_id="conv-1",
        file_id="f-1",
        filename="doc.pdf",
        file_size=1024,
        mime_type="application/pdf",
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_FILE_UPLOADED
    assert kwargs["details"] == {
        "file_id": "f-1",
        "filename": "doc.pdf",
        "file_size": 1024,
        "mime_type": "application/pdf",
    }


async def test_log_file_deleted(service, repo):
    await service.log_file_deleted(
        username="user1",
        conversation_id="conv-1",
        file_id="f-1",
        filename="doc.pdf",
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_FILE_DELETED
    assert kwargs["details"] == {"file_id": "f-1", "filename": "doc.pdf"}


async def test_log_stream_started(service, repo):
    await service.log_stream_started(
        username="user1",
        conversation_id="conv-1",
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_STREAM_STARTED
    assert kwargs["conversation_id"] == "conv-1"
    assert kwargs["details"] is None


async def test_log_stream_completed_rounds_duration(service, repo):
    """duration_sec округляется до 3 знаков для компактности JSONB."""
    await service.log_stream_completed(
        username="user1",
        conversation_id="conv-1",
        duration_sec=1.234567,
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_STREAM_COMPLETED
    assert kwargs["details"] == {"duration_sec": 1.235}


async def test_log_stream_aborted_with_reason(service, repo):
    await service.log_stream_aborted(
        username="user1",
        conversation_id="conv-1",
        reason="client_disconnected",
        duration_sec=2.5,
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["action"] == AUDIT_STREAM_ABORTED
    assert kwargs["details"] == {
        "reason": "client_disconnected",
        "duration_sec": 2.5,
    }


async def test_repo_exception_is_swallowed(service, repo, caplog):
    """Сбой записи audit-лога НЕ должен пробрасываться наружу."""
    repo.log = AsyncMock(side_effect=RuntimeError("БД недоступна"))
    # Не должно подняться исключение
    await service.log_conversation_created(
        username="user1",
        conversation_id="conv-1",
    )
    # При этом warning залогирован
    assert any(
        "audit-log" in record.getMessage().lower()
        for record in caplog.records
    )


async def test_repo_exception_swallowed_on_all_methods(service, repo):
    """Все методы log_* проглатывают исключения репозитория."""
    repo.log = AsyncMock(side_effect=RuntimeError("boom"))
    await service.log_conversation_created(
        username="u", conversation_id="c",
    )
    await service.log_conversation_deleted(username="u", conversation_id="c")
    await service.log_message_sent(username="u", conversation_id="c")
    await service.log_file_uploaded(username="u", conversation_id="c")
    await service.log_file_deleted(username="u")
    await service.log_stream_started(username="u", conversation_id="c")
    await service.log_stream_completed(username="u", conversation_id="c")
    await service.log_stream_aborted(username="u", conversation_id="c")
    # Все 8 вызовов прошли, всё проглотилось
    assert repo.log.await_count == 8


async def test_details_with_unicode_passed_through(service, repo):
    """Кириллица в title попадает в details без потерь (сериализация — задача репо)."""
    await service.log_conversation_created(
        username="u",
        conversation_id="c",
        title="Тестовая беседа",
    )
    kwargs = repo.log.call_args.kwargs
    assert kwargs["details"]["title"] == "Тестовая беседа"


async def test_service_with_batcher_does_not_call_repo(repo):
    """Если в конструктор передан batcher — пишем в него, repo.log() НЕ зовётся."""
    batcher = AsyncMock()
    batcher.add = AsyncMock()
    svc = ChatAuditService(repo=repo, batcher=batcher)
    await svc.log_conversation_created(
        username="user1",
        conversation_id="conv-1",
        title="T",
    )
    batcher.add.assert_awaited_once()
    record = batcher.add.call_args.args[0]
    assert record.username == "user1"
    assert record.action == AUDIT_CONVERSATION_CREATED
    assert record.conversation_id == "conv-1"
    assert record.details == {"title": "T"}
    repo.log.assert_not_called()


async def test_service_with_batcher_swallows_batcher_exception(repo, caplog):
    """Если batcher.add() падает — наружу не пробрасывается, есть warning."""
    batcher = AsyncMock()
    batcher.add = AsyncMock(side_effect=RuntimeError("batcher broken"))
    svc = ChatAuditService(repo=repo, batcher=batcher)
    # Не должно подняться исключение
    await svc.log_conversation_deleted(username="u", conversation_id="c")
    assert any(
        "audit-log" in record.getMessage().lower()
        for record in caplog.records
    )
    repo.log.assert_not_called()
