"""Тесты сервиса центра уведомлений.

Сервис — тонкая обёртка над репозиторием: проверяем делегирование и то,
что push генерирует id и передаёт created_by.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.notifications.services.notification_service import (
    NotificationService,
)


@pytest.fixture
def service():
    """NotificationService с замоканным репозиторием (conn не используется)."""
    with patch(
        "app.domains.notifications.services.notification_service.NotificationRepository"
    ) as RepoCls:
        repo = MagicMock()
        repo.list_for_user = AsyncMock(return_value=[{"id": "n1"}])
        repo.unread_summary = AsyncMock(
            return_value={"count": 5, "severity": "warning"}
        )
        repo.mark_read = AsyncMock()
        repo.mark_all_read = AsyncMock()
        repo.dismiss = AsyncMock()
        repo.create = AsyncMock(return_value="generated-id")
        RepoCls.return_value = repo
        svc = NotificationService(conn=MagicMock())
        svc._repo_mock = repo  # для ассертов в тестах
        yield svc


async def test_list_for_user_delegates(service):
    """list_for_user делегирует в repo с limit."""
    result = await service.list_for_user("user1", limit=20)
    assert result == [{"id": "n1"}]
    service._repo_mock.list_for_user.assert_awaited_once_with("user1", limit=20)


async def test_unread_summary_delegates(service):
    """unread_summary делегирует в repo (count + severity)."""
    assert await service.unread_summary("user1") == {
        "count": 5,
        "severity": "warning",
    }
    service._repo_mock.unread_summary.assert_awaited_once_with("user1")


async def test_mark_read_delegates(service):
    """mark_read делегирует в repo."""
    await service.mark_read("n1", "user1")
    service._repo_mock.mark_read.assert_awaited_once_with("n1", "user1")


async def test_mark_all_read_delegates(service):
    """mark_all_read делегирует в repo."""
    await service.mark_all_read("user1")
    service._repo_mock.mark_all_read.assert_awaited_once_with("user1")


async def test_dismiss_delegates(service):
    """dismiss делегирует в repo."""
    await service.dismiss("n1", "user1")
    service._repo_mock.dismiss.assert_awaited_once_with("n1", "user1")


async def test_push_generates_id_and_returns_it(service):
    """push возвращает id (из repo.create) и генерирует uuid для create."""
    with patch(
        "app.domains.notifications.services.notification_service.uuid"
    ) as mock_uuid:
        mock_uuid.uuid4.return_value = "fixed-uuid"
        result = await service.push(source="acts", title="Готов акт")

    assert result == "generated-id"
    kwargs = service._repo_mock.create.await_args.kwargs
    assert kwargs["id"] == "fixed-uuid"
    assert kwargs["source"] == "acts"
    assert kwargs["title"] == "Готов акт"
    # дефолты
    assert kwargs["severity"] == "info"
    assert kwargs["recipient_user_id"] is None
    assert kwargs["created_by"] == "system"


async def test_push_passes_created_by_and_recipient(service):
    """push прокидывает created_by и recipient_user_id в repo.create."""
    await service.push(
        source="manual",
        title="Лично тебе",
        severity="warning",
        recipient_user_id="user2",
        created_by="user1",
        link="/constructor?act_id=7",
    )
    kwargs = service._repo_mock.create.await_args.kwargs
    assert kwargs["created_by"] == "user1"
    assert kwargs["recipient_user_id"] == "user2"
    assert kwargs["severity"] == "warning"
    assert kwargs["link"] == "/constructor?act_id=7"
