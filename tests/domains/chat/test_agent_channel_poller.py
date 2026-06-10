"""Тесты AgentChannelPoller.

Тестируются: subscribe (идемпотентность, поля entry), reconcile (восстановление
реестра), _tick (done/pending/idle-таймауты по фазам/liveness-сигналы).

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
    adapter.get_table_name = lambda name, schema='': name
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


def _poll_res(**overrides):
    """Базовый poll_once-результат с возможностью перекрытия полей."""
    res = {
        "outcome": "pending",
        "question_status": "pending",
        "answer_exists": False,
        "reasoning_len": 0,
        "queue_ahead": None,
        "answer_updated_at": None,
    }
    res.update(overrides)
    return res


# ── subscribe ─────────────────────────────────────────────────────────────────


class TestSubscribe:

    def test_subscribe_adds_full_entry(self, settings):
        """subscribe создаёт entry со всеми полями idle-состояния."""
        t = [10.0]
        poller = _make_poller(settings, now=lambda: t[0])
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        entry = poller._subscriptions["Q1"]
        assert entry["assistant_message_id"] == "m1"
        assert entry["last_activity"] == 10.0
        assert entry["phase"] == "pending"
        assert entry["last_reasoning_len"] == 0
        assert entry["last_queue_ahead"] is None
        assert entry["last_answer_updated_at"] is None

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

        t = [5.0]
        poller = _make_poller(settings, now=lambda: t[0], mock_conn=mock_conn)
        await poller.reconcile()

        assert "Q1" in poller._subscriptions
        entry = poller._subscriptions["Q1"]
        assert entry["assistant_message_id"] == "m1"
        # Восстановленная подписка — phase='pending', last_activity=now (момент reconcile).
        assert entry["phase"] == "pending"
        assert entry["last_activity"] == 5.0

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
        """Если poll_once возвращает outcome='done' — подписка снимается."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
            new_callable=AsyncMock,
            return_value=_poll_res(outcome="done", question_status="completed", answer_exists=True),
        ):
            n = await poller._tick(mock_conn)

        assert n == 1
        assert "Q1" not in poller._subscriptions

    async def test_tick_done_does_not_call_mark_timeout(self, settings, mock_conn):
        """При outcome='done' mark_timeout НЕ вызывается."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with (
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
                new_callable=AsyncMock,
                return_value=_poll_res(outcome="done", question_status="completed", answer_exists=True),
            ),
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
                new_callable=AsyncMock,
            ) as mock_mark,
        ):
            await poller._tick(mock_conn)

        mock_mark.assert_not_called()

    async def test_tick_pending_no_liveness_claim_timeout(self, settings, mock_conn):
        """pending без признаков жизни: по истечении claim_timeout — mark_timeout(reason='claim')."""
        claim_timeout = settings.agent_channel.claim_timeout_sec
        # now[0]=0.0 при subscribe, now[1]=claim_timeout+1 при _tick
        times = [0.0, float(claim_timeout + 1)]
        idx = [0]

        def fake_now():
            val = times[idx[0]]
            idx[0] = min(idx[0] + 1, len(times) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        # Первый тик устанавливает baseline queue_ahead (None → None, без activity)

        with (
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
                new_callable=AsyncMock,
                return_value=_poll_res(),  # pending, нет признаков жизни
            ),
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
                new_callable=AsyncMock,
            ) as mock_mark,
        ):
            n = await poller._tick(mock_conn)

        mock_mark.assert_called_once_with(
            assistant_message_id="m1",
            question_uid="Q1",
            reason="claim",
        )
        assert n == 1
        assert "Q1" not in poller._subscriptions

    async def test_tick_queue_movement_extends_claim_timeout(self, settings, mock_conn):
        """Движение очереди продлевает idle-таймаут (тик1 baseline, тик2 activity, тик3 жив)."""
        claim_timeout = settings.agent_channel.claim_timeout_sec
        # Временная шкала: subscribe=0, тик1=10, тик2=claim_timeout-5, тик3=claim_timeout+1
        times = [0.0, 10.0, float(claim_timeout - 5), float(claim_timeout + 1)]
        idx = [0]

        def fake_now():
            val = times[idx[0]]
            idx[0] = min(idx[0] + 1, len(times) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with (
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
                new_callable=AsyncMock,
            ) as mock_poll,
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
                new_callable=AsyncMock,
            ) as mock_mark,
        ):
            # Тик 1: queue_ahead=5 — baseline (НЕ activity), now=10
            mock_poll.return_value = _poll_res(queue_ahead=5)
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == 0.0  # не обновилась

            # Тик 2: queue_ahead=3 → уменьшилось → activity, now=claim_timeout-5
            mock_poll.return_value = _poll_res(queue_ahead=3)
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == float(claim_timeout - 5)

            # Тик 3: now=claim_timeout+1; от last_activity=(claim_timeout-5) прошло 6 сек < claim_timeout
            mock_poll.return_value = _poll_res(queue_ahead=3)
            n = await poller._tick(mock_conn)

        mock_mark.assert_not_called()  # таймаута нет
        assert n == 0
        assert "Q1" in poller._subscriptions

    async def test_tick_phase_transition_to_processing_triggers_answer_timeout(
        self, settings, mock_conn
    ):
        """Переход в processing меняет лимит на answer_timeout_sec."""
        answer_timeout = settings.agent_channel.answer_timeout_sec
        # subscribe=0, тик1=5 (переход в processing), тик2=5+answer_timeout+1
        times = [0.0, 5.0, float(5 + answer_timeout + 1)]
        idx = [0]

        def fake_now():
            val = times[idx[0]]
            idx[0] = min(idx[0] + 1, len(times) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with (
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
                new_callable=AsyncMock,
            ) as mock_poll,
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
                new_callable=AsyncMock,
            ) as mock_mark,
        ):
            # Тик 1: answer_exists=True → phase становится processing, activity=5
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing")
            n1 = await poller._tick(mock_conn)
            assert n1 == 0
            assert poller._subscriptions["Q1"]["phase"] == "processing"
            assert poller._subscriptions["Q1"]["last_activity"] == 5.0

            # Тик 2: now=5+answer_timeout+1, reasoning не растёт → таймаут answer
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing")
            n2 = await poller._tick(mock_conn)

        mock_mark.assert_called_once_with(
            assistant_message_id="m1",
            question_uid="Q1",
            reason="answer",
        )
        assert n2 == 1
        assert "Q1" not in poller._subscriptions

    async def test_tick_reasoning_growth_extends_answer_timeout(self, settings, mock_conn):
        """Рост reasoning_len продлевает idle-таймаут в фазе processing."""
        answer_timeout = settings.agent_channel.answer_timeout_sec
        # subscribe=0, тик1=5 (переход в processing+reasoning=10, activity=5)
        # тик2=5+answer_timeout-1 (reasoning растёт до 25, activity обновляется)
        # тик3=5+answer_timeout-1+answer_timeout+1 (reasoning не растёт → таймаут)
        t1 = 5.0
        t2 = t1 + answer_timeout - 1
        t3 = t2 + answer_timeout + 1
        times = [0.0, t1, t2, t3]
        idx = [0]

        def fake_now():
            val = times[idx[0]]
            idx[0] = min(idx[0] + 1, len(times) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with (
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
                new_callable=AsyncMock,
            ) as mock_poll,
            patch(
                "app.domains.chat.services.agent_channel.AgentChannelService.mark_timeout",
                new_callable=AsyncMock,
            ) as mock_mark,
        ):
            # Тик 1: переход в processing, reasoning_len=10 → alive=True
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing", reasoning_len=10)
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == t1

            # Тик 2: reasoning растёт 10→25 → alive=True, last_activity=t2
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing", reasoning_len=25)
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == t2

            # Тик 3: reasoning не растёт (25=25), now=t3, t3-t2=answer_timeout+1 → таймаут
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing", reasoning_len=25)
            n = await poller._tick(mock_conn)

        mock_mark.assert_called_once_with(
            assistant_message_id="m1",
            question_uid="Q1",
            reason="answer",
        )
        assert n == 1

    async def test_tick_pending_keeps_subscription_no_liveness(self, settings, mock_conn):
        """Если poll_once возвращает outcome='pending' без признаков жизни — подписка остаётся."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
            new_callable=AsyncMock,
            return_value=_poll_res(),
        ):
            n = await poller._tick(mock_conn)

        assert n == 0
        assert "Q1" in poller._subscriptions

    async def test_tick_want_queue_position_only_in_pending(self, settings, mock_conn):
        """want_queue_position=True только в pending-фазе; в processing — False."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
            new_callable=AsyncMock,
        ) as mock_poll:
            # Тик 1: pending → want_queue_position=True
            mock_poll.return_value = _poll_res()
            await poller._tick(mock_conn)
            kwargs1 = mock_poll.call_args.kwargs
            assert kwargs1["want_queue_position"] is True

            # Переключаем в processing вручную
            poller._subscriptions["Q1"]["phase"] = "processing"

            # Тик 2: processing → want_queue_position=False
            mock_poll.return_value = _poll_res(answer_exists=True, question_status="processing")
            await poller._tick(mock_conn)
            kwargs2 = mock_poll.call_args.kwargs
            assert kwargs2["want_queue_position"] is False

    async def test_tick_answer_updated_at_first_observation_is_baseline(
        self, settings, mock_conn
    ):
        """Первое ненулевое answer_updated_at — baseline (не activity); второе изменение — activity."""
        import datetime

        dt1 = datetime.datetime(2024, 1, 1, 12, 0, 0)
        dt2 = datetime.datetime(2024, 1, 1, 12, 0, 5)

        times = [0.0, 10.0, 20.0]
        idx = [0]

        def fake_now():
            val = times[idx[0]]
            idx[0] = min(idx[0] + 1, len(times) - 1)
            return val

        poller = _make_poller(settings, now=fake_now, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        # Переводим в processing, чтобы answer_updated_at был релевантен
        poller._subscriptions["Q1"]["phase"] = "processing"

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
            new_callable=AsyncMock,
        ) as mock_poll:
            # Тик 1 (now=10): первое наблюдение answer_updated_at=dt1 → baseline, НЕ activity
            mock_poll.return_value = _poll_res(
                answer_exists=True, question_status="processing", answer_updated_at=dt1
            )
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == 0.0  # не обновилась при subscribe
            assert poller._subscriptions["Q1"]["last_answer_updated_at"] == dt1

            # Тик 2 (now=20): answer_updated_at изменился dt1→dt2 → activity
            mock_poll.return_value = _poll_res(
                answer_exists=True, question_status="processing", answer_updated_at=dt2
            )
            await poller._tick(mock_conn)
            assert poller._subscriptions["Q1"]["last_activity"] == 20.0

    async def test_tick_exception_in_one_subscription_does_not_abort(
        self, settings, mock_conn
    ):
        """Ошибка в одной подписке не прерывает обработку остальных."""
        poller = _make_poller(settings, mock_conn=mock_conn)
        poller.subscribe(assistant_message_id="m1", question_uid="Q1")
        poller.subscribe(assistant_message_id="m2", question_uid="Q2")

        async def _poll_once_side_effect(**kwargs):
            if kwargs.get("question_uid") == "Q1":
                raise RuntimeError("симулируем ошибку")
            return _poll_res(outcome="done", question_status="completed", answer_exists=True)

        with patch(
            "app.domains.chat.services.agent_channel.AgentChannelService.poll_once",
            new_callable=AsyncMock,
            side_effect=_poll_once_side_effect,
        ):
            n = await poller._tick(mock_conn)

        # Q2 обработан успешно — считается как done.
        assert n == 1
        assert "Q2" not in poller._subscriptions
        # Q1 остался в реестре — не удалён при ошибке.
        assert "Q1" in poller._subscriptions
