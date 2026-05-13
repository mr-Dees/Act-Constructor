"""Тесты гонок (race conditions) домена чата.

Покрывает: конкурентное создание бесед/сообщений с обходом лимитов,
дублирование бесед при ensureConversation, удаление во время стримин��а.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest

from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.services.conversation_service import ConversationService
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
    yield
    reset_registry()
    reset_settings()
    reset_tools()


@pytest.fixture
def settings():
    """Настройки чата с малыми лимитами для тестов гонок."""
    return ChatDomainSettings(
        max_conversations_per_user=2,
        max_messages_per_conversation=5,
    )


@pytest.fixture
def conv_repo():
    """Mock ConversationRepository."""
    return AsyncMock()


@pytest.fixture
def msg_repo():
    """Mock MessageRepository."""
    return AsyncMock()


@pytest.fixture
def conv_service(conv_repo, settings):
    """ConversationService с mock-зависимостями."""
    return ConversationService(conv_repo=conv_repo, settings=settings)


@pytest.fixture
def msg_service(msg_repo, conv_repo, settings):
    """MessageService с mock-зависимостями."""
    return MessageService(msg_repo=msg_repo, conv_repo=conv_repo, settings=settings)


# -------------------------------------------------------------------------
# BUG #9: Race condition в проверке лимита бесед
# -------------------------------------------------------------------------


class TestConversationLimitRaceCondition:
    """BUG: count_by_user + create не атомарны.
    Два конкурентных запроса могут пройти проверку лимита
    и оба успешно создать беседу, превысив лимит.
    """

    async def test_concurrent_creation_exceeds_limit(self, settings):
        """Конкурентные запросы на создание могут превысить лимит.

        Имитируем гонку: count всегда возвращает значение ДО завершения create,
        поэтому все конкурентные запросы проходят проверку лимита.
        """
        conv_repo = AsyncMock()
        actual_count = 1  # В БД уже 1 беседа (лимит=2)

        async def mock_count(user_id):
            # Все конкурентные вызовы видят одинаковый snapshot до create
            return actual_count

        async def mock_create(**kwargs):
            nonlocal actual_count
            await asyncio.sleep(0.01)  # Имитация задержки записи
            actual_count += 1
            return {"id": f"conv-{actual_count}", "user_id": kwargs["user_id"], "title": None}

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # 2 конкурентных запроса — оба видят count=1 при лимите=2
        tasks = [service.create(user_id="user1") for _ in range(2)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = [r for r in results if not isinstance(r, Exception)]

        # BUG: Обе создались — итого 3 беседы при лимите 2
        assert len(successful) == 2, (
            f"BUG: {len(successful)} бесед создано конкурентно при лимите 2 (уже было 1)"
        )

    async def test_race_with_asyncio_tasks(self, settings):
        """Имитация гонки через asyncio.gather."""
        conv_repo = AsyncMock()
        creation_count = 0

        async def mock_count_by_user(user_id):
            # Все задачи видят одинаковый count до завершения create
            return creation_count

        async def mock_create(**kwargs):
            nonlocal creation_count
            # Небольшая задержка — имитация обращения к БД
            await asyncio.sleep(0.01)
            creation_count += 1
            return {"id": f"conv-{creation_count}", "user_id": kwargs["user_id"]}

        conv_repo.count_by_user = mock_count_by_user
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # Запускаем 3 создания параллельно при лимите 2
        tasks = [
            service.create(user_id="user1")
            for _ in range(3)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Все 3 должны пройти, т.к. все видят count=0 (BUG)
        successful = [r for r in results if not isinstance(r, Exception)]
        assert len(successful) == 3, (
            f"BUG: Все 3 создания прошли при лимите 2. "
            f"Успешных: {len(successful)}, ошибок: {len(results) - len(successful)}"
        )

    async def test_limit_check_returns_stale_count(self, settings):
        """count_by_user может вернуть устаревшее значение —
        между count и create другой процесс создал беседу.
        """
        conv_repo = AsyncMock()
        real_count = 1  # реально в БД

        async def mock_count(user_id):
            return real_count  # Возвращает stale-значение

        async def mock_create(**kwargs):
            nonlocal real_count
            real_count += 1
            return {"id": "conv-new", "user_id": kwargs["user_id"], "title": None}

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # Между count_by_user (видит 1) и create — другой процесс создал 1
        # Мы не видим изменения — create проходит
        # Имитируем: в промежутке count стал 2 (лимит), но мы уже прошли проверку
        result = await service.create(user_id="user1")
        assert result is not None
        # Реально в БД теперь 2, а лимит 2 — но проверка прошла по stale count=1


# -------------------------------------------------------------------------
# BUG #10: Race condition в проверке лимита с��общений
# -------------------------------------------------------------------------


class TestMessageLimitRaceCondition:
    """BUG: count_by_conversation + create не атомарны.
    Аналогично беседам — конкурентные сообщения могут превысить лимит.
    """

    async def test_concurrent_messages_exceed_limit(self, settings):
        """Конкурентные сообщения могут превысить лимит.

        Имитируем гонку: count всегда возвращает snapshot до создания,
        поэтому все конкурентные запросы проходят проверку.
        """
        msg_repo = AsyncMock()
        conv_repo = AsyncMock()
        actual_count = 4  # В БД уже 4 (лимит=5)

        async def mock_count(conversation_id):
            return actual_count

        async def mock_create(**kwargs):
            nonlocal actual_count
            await asyncio.sleep(0.01)
            actual_count += 1
            return {"id": f"msg-{actual_count}", "role": "user", "content": kwargs.get("content", [])}

        msg_repo.count_by_conversation = mock_count
        msg_repo.create = mock_create
        conv_repo.touch = AsyncMock()

        service = MessageService(msg_repo=msg_repo, conv_repo=conv_repo, settings=settings)

        # 2 конкурентных сообщения — оба видят count=4 при лимите=5
        tasks = [
            service.save_user_message(conversation_id="conv-1", content=f"Msg {i}", user_id="user1")
            for i in range(2)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = [r for r in results if not isinstance(r, Exception)]

        # BUG: Оба прошли — итого 6 сообщений при лимите 5
        assert len(successful) == 2, (
            f"BUG: {len(successful)} сообщений создано при лимите 5 (уже было 4)"
        )

    async def test_race_with_asyncio_tasks(self, settings):
        """Имитация гонки сообщений через asyncio.gather."""
        msg_repo = AsyncMock()
        conv_repo = AsyncMock()
        message_count = 0

        async def mock_count(conversation_id):
            return message_count

        async def mock_create(**kwargs):
            nonlocal message_count
            await asyncio.sleep(0.01)
            message_count += 1
            return {
                "id": f"msg-{message_count}",
                "role": "user",
                "content": kwargs.get("content", []),
            }

        msg_repo.count_by_conversation = mock_count
        msg_repo.create = mock_create
        conv_repo.touch = AsyncMock()

        service = MessageService(
            msg_repo=msg_repo, conv_repo=conv_repo, settings=settings,
        )

        # 6 сообщений параллельно при лимите 5
        tasks = [
            service.save_user_message(
                conversation_id="conv-1",
                content=f"Msg {i}",
                user_id="user1",
            )
            for i in range(6)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        # BUG: Все 6 проходят, т.к. все видят count=0
        assert len(successful) == 6, (
            f"BUG: {len(successful)} сообщений создано при лимите 5"
        )


# -------------------------------------------------------------------------
# BUG #14: ensureConversation — дублирование бесед
# -------------------------------------------------------------------------


class TestEnsureConversationRace:
    """BUG (фронтенд): При конкурентных вызовах ensureConversation
    оба могут создать беседу, если проверка существования не атомарна.

    На бэкенде — нет серверной блокировки create + check.
    """

    async def test_concurrent_creates_produce_duplicates(self, settings):
        """Конкурентные create для одного пользователя создают дубликаты
        с одинаковым заголовком — нет server-side дедупликации.
        """
        conv_repo = AsyncMock()
        creation_count = 0

        async def mock_count(user_id):
            return creation_count

        async def mock_create(**kwargs):
            nonlocal creation_count
            await asyncio.sleep(0.01)
            creation_count += 1
            return {
                "id": f"conv-{creation_count}",
                "user_id": kwargs["user_id"],
                "title": kwargs.get("title"),
            }

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # Конкурентные создания с одинаковым title
        tasks = [service.create(user_id="user1", title="Дубликат") for _ in range(2)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = [r for r in results if not isinstance(r, Exception)]

        # Оба создались — дубликаты по title, разные id
        assert len(successful) == 2
        assert successful[0]["id"] != successful[1]["id"]
        assert successful[0]["title"] == successful[1]["title"] == "Дубликат"

    async def test_concurrent_ensure_creates_duplicates(self, settings):
        """Конкурентный ensureConversation создаёт дубликаты."""
        conv_repo = AsyncMock()
        creation_count = 0

        async def mock_count(user_id):
            return creation_count

        async def mock_create(**kwargs):
            nonlocal creation_count
            await asyncio.sleep(0.01)  # Имитация задержки
            creation_count += 1
            return {
                "id": f"conv-{creation_count}",
                "user_id": kwargs["user_id"],
                "title": kwargs.get("title"),
                "domain_name": kwargs.get("domain_name"),
            }

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # Имитируем конкурентный ensureConversation
        tasks = [
            service.create(user_id="user1", domain_name="acts")
            for _ in range(3)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        # Все 3 создались — дубликаты
        assert len(successful) == 3


# -------------------------------------------------------------------------
# BUG #15: Переключение беседы во время стриминга
# -------------------------------------------------------------------------


class TestConversationSwitchDuringStreaming:
    """BUG (фронтенд): Переключение беседы во время стриминга
    не прерывает генератор — сообщение сохраняется в старую беседу.

    На бэкенде нет механизма отмены streaming generator.
    """

    async def test_delete_conversation_during_streaming_no_lock(
        self, conv_service, conv_repo,
    ):
        """Удаление беседы возможно даже во время активного стриминга.

        Нет механизма блокировки беседы на время стриминга.
        """
        conv_repo.delete.return_value = True

        # Беседа может быть удалена в любой момент
        result = await conv_service.delete("conv-1", "user1")
        assert result is True


# -------------------------------------------------------------------------
# Атомарность операций
# -------------------------------------------------------------------------


class TestAtomicity:
    """Тесты на отсутствие атомарности в критических операциях."""

    async def test_save_user_message_and_touch_not_transactional(
        self, msg_service, msg_repo, conv_repo,
    ):
        """Сохранение сообщения и touch не в одной транзакции.

        Если touch упадёт, сообщение уже создано.
        """
        msg_repo.count_by_conversation.return_value = 0
        msg_repo.create.return_value = {
            "id": "msg-1",
            "role": "user",
            "content": [{"type": "text", "content": "Тест"}],
        }
        conv_repo.touch.side_effect = RuntimeError("DB error in touch")

        with pytest.raises(RuntimeError, match="DB error in touch"):
            await msg_service.save_user_message(
                conversation_id="conv-1",
                content="Тест",
                user_id="user1",
            )

        # Сообщение создано, но touch упал — неконсистентность
        msg_repo.create.assert_called_once()
