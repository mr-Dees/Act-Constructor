"""Тесты гонок (race conditions) домена чата.

Покрывает: конкурентное создание бесед/сообщений с обходом лимитов,
дублирование бесед при ensureConversation, удаление во время стриминга.

Все сценарии проверяют, что соответствующие баги (BUG #9, #10, #14, #15)
ИСПРАВЛЕНЫ: критические секции защищены per-user asyncio.Lock в сервисах,
ensureConversation идемпотентен по title, а delete блокируется при
активном SSE-стриме (ConversationLockedError, 409).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.exceptions import (
    ChatLimitError,
    ConversationLockedError,
)
from app.domains.chat.services import conversation_service as conv_svc_module
from app.domains.chat.services.conversation_service import ConversationService
from app.domains.chat.services.message_service import MessageService
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс глобального состояния реестров и per-user локов между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    conv_svc_module._user_locks.clear()
    yield
    reset_registry()
    reset_settings()
    reset_tools()
    conv_svc_module._user_locks.clear()


@pytest.fixture
def settings():
    """Настройки чата с малыми лимитами для тестов гонок."""
    return ChatDomainSettings(
        max_conversations_per_user=2,
        max_messages_per_conversation=5,
    )


def _mock_repo_with_conn():
    """Создаёт мок репозитория с conn.transaction() для MessageService."""
    repo = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    repo.conn = MagicMock()
    repo.conn.transaction = MagicMock(return_value=tx)
    return repo


@pytest.fixture
def conv_repo():
    """Mock ConversationRepository."""
    repo = _mock_repo_with_conn()
    # По умолчанию беседы с таким title не существует — идемпотентность
    # не срабатывает, тесты могут переопределить.
    repo.get_by_user_and_title = AsyncMock(return_value=None)
    return repo


@pytest.fixture
def msg_repo():
    """Mock MessageRepository."""
    return _mock_repo_with_conn()


@pytest.fixture
def conv_service(conv_repo, settings):
    """ConversationService с mock-зависимостями."""
    return ConversationService(conv_repo=conv_repo, settings=settings)


@pytest.fixture
def msg_service(msg_repo, conv_repo, settings):
    """MessageService с mock-зависимостями."""
    return MessageService(msg_repo=msg_repo, conv_repo=conv_repo, settings=settings)


# -------------------------------------------------------------------------
# BUG #9: Race condition в проверке лимита бесед — ИСПРАВЛЕНО
# -------------------------------------------------------------------------


class TestConversationLimitRaceCondition:
    """count_by_user + create атомарны под per-user asyncio.Lock.
    Конкурентные запросы сериализуются и лимит не превышается.
    """

    async def test_concurrent_creation_respects_limit(self, settings):
        """Конкурентные create уважают лимит благодаря per-user lock.

        Из 2 параллельных запросов при count=1 и лимите=2: один проходит,
        второй получает ChatLimitError.
        """
        conv_repo = _mock_repo_with_conn()
        conv_repo.get_by_user_and_title = AsyncMock(return_value=None)
        actual_count = 1  # В БД уже 1 беседа (лимит=2)

        async def mock_count(user_id):
            return actual_count

        async def mock_create(**kwargs):
            nonlocal actual_count
            await asyncio.sleep(0.01)  # Имитация задержки записи
            actual_count += 1
            return {"id": f"conv-{actual_count}", "user_id": kwargs["user_id"], "title": None}

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        tasks = [service.create(user_id="user1") for _ in range(2)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        errors = [r for r in results if isinstance(r, ChatLimitError)]

        assert len(successful) == 1, (
            f"Ожидался ровно 1 успех при count=1 и лимите=2, получено {len(successful)}"
        )
        assert len(errors) == 1, (
            f"Ожидалась ровно 1 ошибка ChatLimitError, получено {len(errors)}"
        )

    async def test_race_with_asyncio_tasks(self, settings):
        """Параллельные 3 create при лимите=2 — 2 проходят, 1 падает."""
        conv_repo = _mock_repo_with_conn()
        conv_repo.get_by_user_and_title = AsyncMock(return_value=None)
        creation_count = 0

        async def mock_count_by_user(user_id):
            return creation_count

        async def mock_create(**kwargs):
            nonlocal creation_count
            await asyncio.sleep(0.01)
            creation_count += 1
            return {"id": f"conv-{creation_count}", "user_id": kwargs["user_id"]}

        conv_repo.count_by_user = mock_count_by_user
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        tasks = [service.create(user_id="user1") for _ in range(3)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        errors = [r for r in results if isinstance(r, ChatLimitError)]

        assert len(successful) == 2, (
            f"Ожидалось 2 успеха при лимите=2, получено {len(successful)}"
        )
        assert len(errors) == 1, (
            f"Ожидалась 1 ошибка ChatLimitError, получено {len(errors)}"
        )

    async def test_limit_check_uses_fresh_count(self, settings):
        """Под lock'ом count_by_user читается синхронно с create —
        stale значения от другого процесса исключены в single-worker
        режиме (см. app/core/singleton_lock.py).
        """
        conv_repo = _mock_repo_with_conn()
        conv_repo.get_by_user_and_title = AsyncMock(return_value=None)
        real_count = 1

        async def mock_count(user_id):
            return real_count

        async def mock_create(**kwargs):
            nonlocal real_count
            real_count += 1
            return {"id": "conv-new", "user_id": kwargs["user_id"], "title": None}

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        # Один запрос проходит — count=1 < 2.
        result = await service.create(user_id="user1")
        assert result is not None
        assert real_count == 2

        # Следующий запрос упирается в лимит — count=2 ≥ 2.
        with pytest.raises(ChatLimitError):
            await service.create(user_id="user1")


# -------------------------------------------------------------------------
# BUG #10: Race condition в проверке лимита сообщений — ИСПРАВЛЕНО
# -------------------------------------------------------------------------


class TestMessageLimitRaceCondition:
    """count_by_conversation + create атомарны под per-user lock.
    Аналогично беседам — конкурентные сообщения соблюдают лимит.
    """

    async def test_concurrent_messages_respect_limit(self, settings):
        """2 конкурентных сообщения при count=4 и лимите=5 — проходит одно."""
        msg_repo = _mock_repo_with_conn()
        conv_repo = _mock_repo_with_conn()
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

        tasks = [
            service.save_user_message(conversation_id="conv-1", content=f"Msg {i}", user_id="user1")
            for i in range(2)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        errors = [r for r in results if isinstance(r, ChatLimitError)]

        assert len(successful) == 1, (
            f"Ожидался 1 успех при count=4 и лимите=5, получено {len(successful)}"
        )
        assert len(errors) == 1

    async def test_race_with_asyncio_tasks(self, settings):
        """6 параллельных сообщений при лимите=5 — 5 проходят, 1 падает."""
        msg_repo = _mock_repo_with_conn()
        conv_repo = _mock_repo_with_conn()
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
        errors = [r for r in results if isinstance(r, ChatLimitError)]

        assert len(successful) == 5, (
            f"Ожидалось 5 успехов при лимите=5, получено {len(successful)}"
        )
        assert len(errors) == 1


# -------------------------------------------------------------------------
# BUG #14: ensureConversation — server-side идемпотентность по title
# -------------------------------------------------------------------------


class TestEnsureConversationRace:
    """ConversationService.create под per-user lock'ом проверяет
    get_by_user_and_title до вставки — конкурентные ensureConversation
    с одинаковым title возвращают одну и ту же беседу.
    """

    async def test_concurrent_creates_dedup_by_title(self, settings):
        """Конкурентные create с одинаковым title возвращают один объект —
        дубликатов в БД нет (server-side идемпотентность).
        """
        conv_repo = _mock_repo_with_conn()
        creation_count = 0
        # Имитация состояния БД: после первого create запись доступна
        # для get_by_user_and_title.
        existing_by_title: dict[tuple[str, str], dict] = {}

        async def mock_get_by_user_and_title(user_id, title):
            return existing_by_title.get((user_id, title))

        async def mock_count(user_id):
            return creation_count

        async def mock_create(**kwargs):
            nonlocal creation_count
            await asyncio.sleep(0.01)
            creation_count += 1
            row = {
                "id": f"conv-{creation_count}",
                "user_id": kwargs["user_id"],
                "title": kwargs.get("title"),
            }
            existing_by_title[(kwargs["user_id"], kwargs["title"])] = row
            return row

        conv_repo.get_by_user_and_title = mock_get_by_user_and_title
        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        tasks = [service.create(user_id="user1", title="Дубликат") for _ in range(2)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        successful = [r for r in results if not isinstance(r, Exception)]

        assert len(successful) == 2
        # Оба вызова вернули один и тот же объект — дубликата в БД нет.
        assert successful[0]["id"] == successful[1]["id"]
        assert successful[0]["title"] == successful[1]["title"] == "Дубликат"
        assert creation_count == 1, (
            f"Создание выполнено {creation_count} раз — ожидалось 1"
        )

    async def test_concurrent_ensure_respects_limit(self, settings):
        """ensureConversation без title не подлежит дедупликации,
        но лимит беседы по-прежнему соблюдается — из 3 параллельных
        вызовов проходят только 2 (limit=2).
        """
        conv_repo = _mock_repo_with_conn()
        conv_repo.get_by_user_and_title = AsyncMock(return_value=None)
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
                "domain_name": kwargs.get("domain_name"),
            }

        conv_repo.count_by_user = mock_count
        conv_repo.create = mock_create

        service = ConversationService(conv_repo=conv_repo, settings=settings)

        tasks = [
            service.create(user_id="user1", domain_name="acts")
            for _ in range(3)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        successful = [r for r in results if not isinstance(r, Exception)]
        errors = [r for r in results if isinstance(r, ChatLimitError)]
        assert len(successful) == 2
        assert len(errors) == 1


# -------------------------------------------------------------------------
# BUG #15: Удаление беседы во время стриминга — ИСПРАВЛЕНО (409 Conflict)
# -------------------------------------------------------------------------


class TestConversationSwitchDuringStreaming:
    """ConversationService.delete проверяет is_user_streaming(user_id) —
    при активном SSE-стриме бросает ConversationLockedError (409),
    иначе delete отрабатывает штатно.
    """

    async def test_delete_blocked_during_active_stream(
        self, conv_service, conv_repo,
    ):
        """Удаление невозможно при активном SSE-стриме пользователя."""
        with patch(
            "app.domains.chat.api.messages.is_user_streaming",
            return_value=True,
        ):
            with pytest.raises(ConversationLockedError):
                await conv_service.delete("conv-1", "user1")

        # Repository.delete не должен быть вызван.
        conv_repo.delete.assert_not_called()

    async def test_delete_allowed_without_active_stream(
        self, conv_service, conv_repo,
    ):
        """Без активного стрима delete отрабатывает штатно."""
        conv_repo.delete.return_value = True
        with patch(
            "app.domains.chat.api.messages.is_user_streaming",
            return_value=False,
        ):
            result = await conv_service.delete("conv-1", "user1")
        assert result is True


# -------------------------------------------------------------------------
# Атомарность операций
# -------------------------------------------------------------------------


class TestAtomicity:
    """save_user_message и touch обёрнуты в conn.transaction() —
    падение touch откатывает вставку сообщения (атомарность на уровне БД).
    """

    async def test_save_user_message_and_touch_in_transaction(
        self, msg_service, msg_repo, conv_repo,
    ):
        """При падении touch исключение пробрасывается — реальная БД
        откатит и create. На моках мы проверяем только то, что:
        1) транзакция была открыта (transaction() вызван);
        2) исключение от touch не глотается.
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

        # Транзакция открывалась — это и есть гарантия атомарности.
        msg_repo.conn.transaction.assert_called_once()
