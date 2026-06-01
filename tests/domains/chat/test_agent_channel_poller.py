"""Тесты AgentChannelPoller.

Тестируются: subscribe (идемпотентность), reconcile (восстановление реестра),
_tick (done/pending/timeout).

Реальный _run не запускается — тесты работают только с _tick/subscribe/reconcile.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.domains.chat.services.agent_channel_poller import AgentChannelPoller
from app.domains.chat.settings import ChatDomainSettings


# ── Фикстуры ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


@pytest.fixture
def settings():
    return ChatDomainSettings()


@pytest.fixture
def mock_conn():
    conn = AsyncMock()
    conn.fetchrow = AsyncMock()
    conn.fetch = AsyncMock(return_value=[])
    conn.execute = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


def _make_poller(settings, *, now=None, mock_conn=None):
    """Создаёт поллер с инжектированными зависимостями."""
    if mock_conn is not None:
        # Фейковый db — возвращает asynccontextmanager вокруг mock_conn.
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def _fake_db():
            yield mock_conn

        db = _fake_db
    else:
        db = None

    poller = AgentChannelPoller(settings, now=now or (lambda: 0.0), db=db)
    return poller


# ── subscribe ─────────────────────────────────────────────────────────────────


class TestSubscribe:

    def test_subscribe_adds_to_registry(self, settings):
        poller = _make_poller(settings)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        assert "Q1" in poller._subscriptions
        assert poller._subscriptions["Q1"]["assistant_message_id"] == "m1"

    def test_subscribe_idempotent(self, settings):
        """Повторный вызов с тем же uid — реестр не дублируется."""
        poller = _make_poller(settings)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        assert len(poller._subscriptions) == 1

    def test_subscribe_two_different_uids(self, settings):
        poller = _make_poller(settings)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        poller.subscribe(assistant_message_id="m2", question_uid="Q2")
        assert len(poller._subscriptions) == 2


# ── reconcile ─────────────────────────────────────────────────────────────────


class TestReconcile:

    async def test_reconcile_restores_from_get_streaming_drafts(
        self, settings, mock_conn
    ):
        """reconcile читает streaming-drafts и добавляет их в реестр."""
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"id": "m1", "agent_ref": "Q1", "status": "streaming",
                 "conversation_id": "conv1", "role": "assistant",
                 "content": "[]", "model": None, "token_usage": None,
                 "created_at": None, "updated_at": None},
            ]
        )

        poller = _make_poller(settings, mock_conn=mock_conn)
        await poller.reconcile()

        assert "Q1" in poller._subscriptions
        assert poller._subscriptions["Q1"]["assistant_message_id"] == "m1"

    async def test_reconcile_skips_rows_without_agent_ref(
        self, settings, mock_conn
    ):
        """Строки без agent_ref игнорируются."""
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"id": "m1", "agent_ref": None, "status": "streaming",
                 "conversation_id": "conv1", "role": "assistant",
                 "content": "[]", "model": None, "token_usage": None,
                 "created_at": None, "updated_at": None},
            ]
        )

        poller = _make_poller(settings, mock_conn=mock_conn)
        await poller.reconcile()

        assert len(poller._subscriptions) == 0

    async def test_reconcile_idempotent_with_subscribe(
        self, settings, mock_conn
    ):
        """reconcile + subscribe — дублей нет."""
        mock_conn.fetch = AsyncMock(
            return_value=[
                {"id": "m1", "agent_ref": "Q1", "status": "streaming",
                 "conversation_id": "conv1", "role": "assistant",
                 "content": "[]", "model": None, "token_usage": None,
                 "created_at": None, "updated_at": None},
            ]
        )

        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        await poller.reconcile()

        assert len(poller._subscriptions) == 1


# ── get_status ─────────────────────────────────────────────────────────────────


class TestGetStatus:

    def test_get_status_structure(self, settings):
        poller = _make_poller(settings)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        status = poller.get_status()
        assert status["name"] == "chat.agent_channel_poller"
        assert status["running"] is False  # задача не запущена
        assert status["active_subscriptions"] == 1
        assert (
            status["current_interval_sec"]
            == settings.agent_channel.poll_min_interval_sec
        )


# ── _tick ──────────────────────────────────────────────────────────────────────


class TestTick:

    async def test_tick_done_removes_subscription(self, settings, mock_conn):
        """Если try_finalize возвращает 'done' — подписка снимается."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.try_finalize",
            new_callable=AsyncMock,
            return_value="done",
        ):
            n = await poller._tick(mock_conn)

        assert n == 1
        assert "Q1" not in poller._subscriptions

    async def test_tick_pending_keeps_subscription(self, settings, mock_conn):
        """Если try_finalize возвращает 'pending' — подписка остаётся."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.try_finalize",
            new_callable=AsyncMock,
            return_value="pending",
        ):
            n = await poller._tick(mock_conn)

        assert n == 0
        assert "Q1" in poller._subscriptions

    async def test_tick_timeout_calls_mark_timeout_and_removes(
        self, settings, mock_conn
    ):
        """Подписка старше answer_timeout_sec → mark_timeout вызван и снята."""
        timeout = settings.agent_channel.answer_timeout_sec
        # now возвращает время заведомо позднее старта + timeout.
        elapsed = timeout + 1.0
        time_seq = [0.0, elapsed]  # started=0.0, now()=elapsed
        idx = [0]

        def fake_now():
            val = time_seq[idx[0]]
            idx[0] = min(idx[0] + 1, len(time_seq) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        # started зафиксирован при subscribe — это 0.0

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
            new_callable=AsyncMock,
        ) as mock_mark_timeout:
            n = await poller._tick(mock_conn)

        mock_mark_timeout.assert_called_once_with(
            assistant_message_id="m1",
            question_uid="Q1",
        )
        assert n == 1
        assert "Q1" not in poller._subscriptions

    async def test_tick_exception_in_one_subscription_does_not_abort(
        self, settings, mock_conn
    ):
        """Ошибка в одной подписке не прерывает обработку остальных."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        poller.subscribe(assistant_message_id="m2", question_uid="Q2")

        call_count = [0]

        async def _try_finalize_side_effect(**kwargs):
            call_count[0] += 1
            if kwargs.get("question_uid") == "Q1":
                raise RuntimeError("симулируем ошибку")
            return "done"

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.try_finalize",
            new_callable=AsyncMock,
            side_effect=_try_finalize_side_effect,
        ):
            n = await poller._tick(mock_conn)

        # Q2 обработан успешно — считается как done.
        assert n == 1
        assert "Q2" not in poller._subscriptions
        # Q1 остался в реестре — не удалён при ошибке.
        assert "Q1" in poller._subscriptions
