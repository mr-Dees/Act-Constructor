"""Фоновый поллер ответов из bus-таблицы chat_agent_messages_bus.

Один asyncio-task на процесс. Следит за draft-сообщениями (status='streaming',
agent_ref IS NOT NULL) и финализирует их, когда внешний агент заполнит reply_to
на строке-вопросе.

Таймауты — idle-семантика по двум фазам:
  pending   — вопрос ждёт взятия в работу; лимит claim_timeout_sec.
  processing — агент пишет ответ; лимит answer_timeout_sec.
Отсчёт в обеих фазах ведётся от последнего ПРИЗНАКА ЖИЗНИ агента:
смены фазы, роста reasoning, изменения answer.updated_at (начиная со
второго наблюдения), уменьшения числа pending-вопросов впереди.

Adaptive backoff: при активности интервал сбрасывается в min_interval;
при пустом тике растёт × multiplier до max_interval.

Коннект держится только во время _tick — перед sleep освобождается.
"""

from __future__ import annotations

import asyncio
import logging
import time as _time_module
from typing import Any, Callable

from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger("audit_workstation.domains.chat.services.agent_channel_poller")


class AgentChannelPoller:
    """Process-level поллер ответов агента через bus-таблицу chat_agent_messages_bus.

    Инжектируемые зависимости ``now`` и ``db`` упрощают тестирование
    без реального event loop и без реальной БД.
    """

    def __init__(
        self,
        settings: ChatDomainSettings,
        *,
        now: Callable[[], float] = _time_module.monotonic,
        db: Any = None,
    ) -> None:
        """
        settings — ChatDomainSettings (берёт agent_channel).
        now      — провайдер монотонного времени (для тестов).
        db       — async-контекстменеджер вида ``async with db() as conn``;
                   по умолчанию get_db (импортируется внутри, чтобы не
                   тащить зависимость на module-level и оставаться патчабельным).
        """
        self._settings = settings
        self._now = now
        self._db = db  # если None — лениво инициализируем в _get_db_cm()

        # Реестр подписок: uid вопроса → entry-словарь с idle-состоянием.
        self._subscriptions: dict[str, dict] = {}

        self._stop = False
        self._task: asyncio.Task | None = None
        # Текущий интервал backoff'а — для diagnostics-снимка (get_status).
        self._current_interval: float = settings.agent_channel.poll_min_interval_sec

    def get_status(self) -> dict:
        """Снимок состояния поллера для diagnostics-endpoint'а."""
        return {
            "name": "chat.agent_channel_poller",
            "running": self._task is not None and not self._task.done(),
            "active_subscriptions": len(self._subscriptions),
            "current_interval_sec": self._current_interval,
        }

    def _get_db_cm(self):
        """Возвращает async-контекстменеджер коннекта.

        Если db не инжектирован — берёт get_db из connection-модуля.
        Импорт внутри метода обеспечивает патчабельность в тестах.
        """
        if self._db is not None:
            return self._db()
        from app.db.connection import get_db
        return get_db()

    # ── Подписки ──────────────────────────────────────────────────────────────

    def subscribe(self, *, assistant_message_id: str, question_uid: str) -> None:
        """Идемпотентно регистрирует ожидание ответа агента.

        Повторный вызов с тем же question_uid — no-op.

        Entry хранит idle-состояние двухфазного таймаута:
          last_activity  — монотонный timestamp последнего признака жизни агента.
          phase          — 'pending' (ждём взятия в работу) или 'processing'
                           (агент пишет ответ). Лимиты: claim_timeout_sec /
                           answer_timeout_sec соответственно.
          last_reasoning_len   — последняя известная длина reasoning (рост = жив).
          last_queue_ahead     — число pending-вопросов впереди (уменьшение = жив).
          last_answer_updated_at — timestamp ответа при последнем наблюдении;
                           первое ненулевое значение — baseline (не activity),
                           каждое последующее изменение — activity.
        """
        if question_uid in self._subscriptions:
            logger.debug(
                "agent_channel_poller: subscribe no-op, question_uid=%s уже в реестре",
                question_uid,
            )
            return
        self._subscriptions[question_uid] = {
            "assistant_message_id": assistant_message_id,
            # Idle-таймер: момент последнего ПРИЗНАКА ЖИЗНИ агента
            # (движение очереди, взятие в работу, рост reasoning).
            "last_activity": self._now(),
            # Фаза: 'pending' (ждём взятия в работу, лимит claim_timeout_sec)
            # либо 'processing' (ответ пишется, лимит answer_timeout_sec).
            "phase": "pending",
            "last_reasoning_len": 0,
            "last_queue_ahead": None,
            "last_answer_updated_at": None,
        }
        logger.info(
            "agent_channel_poller: подписан question_uid=%s, message_id=%s (всего=%d)",
            question_uid,
            assistant_message_id,
            len(self._subscriptions),
        )

    def unsubscribe(self, question_uid: str) -> None:
        """Убирает подписку. Идемпотентно."""
        self._subscriptions.pop(question_uid, None)

    # ── Тик ───────────────────────────────────────────────────────────────────

    async def _tick(self, conn) -> int:
        """Обходит все подписки и финализирует готовые / таймаутит просроченные.

        Возвращает количество завершённых (done + timeout) за тик.
        Не падает при ошибке одной подписки — оборачивает каждую в try/except.

        Liveness и idle-таймауты по фазам:
          Признаки жизни агента: смена фазы pending → processing, рост
          reasoning_len, изменение answer_updated_at (начиная со второго
          наблюдения), уменьшение queue_ahead.
          Пока фаза 'pending' — лимит cfg.claim_timeout_sec от last_activity.
          Пока фаза 'processing' — лимит cfg.answer_timeout_sec от last_activity.
          Таймаут: mark_timeout(reason='claim'|'answer'), unsubscribe.
        """
        from app.domains.chat.services.agent_channel import AgentChannelService

        cfg = self._settings.agent_channel
        now = self._now()
        done_count = 0

        # Снимок ключей, чтобы безопасно удалять из _subscriptions во время итерации.
        for question_uid in list(self._subscriptions):
            entry = self._subscriptions.get(question_uid)
            if entry is None:
                continue
            assistant_message_id = entry["assistant_message_id"]
            try:
                svc = AgentChannelService(conn, self._settings)
                res = await svc.poll_once(
                    assistant_message_id=assistant_message_id,
                    question_uid=question_uid,
                    last_reasoning_len=entry["last_reasoning_len"],
                    want_queue_position=(entry["phase"] == "pending"),
                )
                if res["outcome"] == "done":
                    self.unsubscribe(question_uid)
                    done_count += 1
                    logger.info(
                        "agent_channel_poller: финализирован question_uid=%s, message_id=%s",
                        question_uid, assistant_message_id,
                    )
                    continue

                # ── Признаки жизни агента ──
                alive = False
                # Фаза монотонна: только pending → processing. Откат строки
                # шины назад (владелец удалил ответ / вернул pending) НЕ
                # возвращает claim-окно и НЕ считается признаком жизни —
                # иначе флаппинг чужой таблицы продлевал бы ожидание вечно.
                observed_processing = (
                    res["answer_exists"]
                    or res["question_status"] not in (None, "pending")
                )
                if entry["phase"] == "pending" and observed_processing:
                    entry["phase"] = "processing"
                    alive = True
                if res["reasoning_len"] > entry["last_reasoning_len"]:
                    entry["last_reasoning_len"] = res["reasoning_len"]
                    alive = True
                if res["answer_updated_at"] is not None:
                    # Первое наблюдение — baseline, не активность; исчезновение
                    # строки-ответа (None) активностью тем более не считается.
                    if (entry["last_answer_updated_at"] is not None
                            and res["answer_updated_at"] != entry["last_answer_updated_at"]):
                        alive = True
                    entry["last_answer_updated_at"] = res["answer_updated_at"]
                qa = res["queue_ahead"]
                if entry["phase"] == "pending" and qa is not None:
                    if entry["last_queue_ahead"] is not None and qa < entry["last_queue_ahead"]:
                        alive = True  # очередь движется — агент жив
                    entry["last_queue_ahead"] = qa
                if alive:
                    entry["last_activity"] = now

                limit_sec = (
                    cfg.claim_timeout_sec if entry["phase"] == "pending"
                    else cfg.answer_timeout_sec
                )
                if now - entry["last_activity"] >= limit_sec:
                    reason = "claim" if entry["phase"] == "pending" else "answer"
                    await svc.mark_timeout(
                        assistant_message_id=assistant_message_id,
                        question_uid=question_uid,
                        reason=reason,
                    )
                    self.unsubscribe(question_uid)
                    done_count += 1
                    logger.info(
                        "agent_channel_poller: таймаут (%s) question_uid=%s, message_id=%s",
                        reason, question_uid, assistant_message_id,
                    )
            except Exception:
                logger.exception(
                    "agent_channel_poller: ошибка при обработке question_uid=%s — пропускаем",
                    question_uid,
                )

        return done_count

    # ── Reconcile ─────────────────────────────────────────────────────────────

    async def reconcile(self) -> None:
        """При старте восстанавливает реестр из streaming-draft'ов с agent_ref.

        Защищает от потери подписок после рестарта uvicorn: все 'streaming'
        сообщения с непустым agent_ref снова попадают в реестр.

        После рестарта восстановленная подписка начинается с фазы 'pending' и
        last_activity=now(): монотонные часы не переживают рестарт, и wall-clock
        created_at draft'а к ним не привести. Idle-таймер отсчитывается заново
        с момента reconcile. Уже отвеченные за время простоя draft'ы
        финализируются на первом же тике (poll_once видит reply_to), так что
        лишнее idle-ожидание касается только реально зависших запросов.
        Фаза после reconcile — 'pending', но первый же тик re-derive'ит её из
        poll_once (строка-ответ существует → сразу 'processing' с answer-лимитом),
        поэтому транзиентная классификация безвредна.
        """
        from app.domains.chat.repositories.message_repository import MessageRepository

        async with self._get_db_cm() as conn:
            drafts = await MessageRepository(conn).get_streaming_drafts()

        restored = 0
        for draft in drafts:
            msg_id = draft.get("id")
            q_uid = draft.get("agent_ref")
            if msg_id and q_uid:
                self.subscribe(
                    assistant_message_id=msg_id,
                    question_uid=q_uid,
                )
                restored += 1

        logger.info(
            "agent_channel_poller: reconcile — восстановлено %d подписок",
            restored,
        )

    # ── Основной цикл ─────────────────────────────────────────────────────────

    async def _run(self) -> None:
        """Фоновый цикл с adaptive backoff. Не падает от одиночных ошибок."""
        cfg = self._settings.agent_channel
        interval = cfg.poll_min_interval_sec

        while not self._stop:
            try:
                if not self._subscriptions:
                    # Подписчиков нет — спим, коннект не берём.
                    interval = cfg.poll_min_interval_sec
                    await asyncio.sleep(interval)
                    continue

                async with self._get_db_cm() as conn:
                    n = await self._tick(conn)
                # Коннект освобождён ДО sleep.

                if n > 0:
                    interval = cfg.poll_min_interval_sec
                else:
                    interval = min(
                        interval * cfg.poll_backoff_multiplier,
                        cfg.poll_max_interval_sec,
                    )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "agent_channel_poller: ошибка в основном цикле — продолжаем",
                )
                interval = cfg.poll_min_interval_sec

            self._current_interval = interval
            await asyncio.sleep(interval)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Создаёт asyncio-задачу фонового цикла. Идемпотентно."""
        if self._task is not None and not self._task.done():
            return
        self._stop = False
        self._task = asyncio.create_task(
            self._run(), name="chat-agent-channel-poller",
        )
        logger.info("agent_channel_poller: запущен")

    async def stop(self) -> None:
        """Останавливает фоновый цикл и ждёт его завершения."""
        self._stop = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        logger.info("agent_channel_poller: остановлен")
