"""Фоновый поллер ответов из bus-таблицы chat_agent_messages_bus.

Один asyncio-task на процесс. Следит за draft-сообщениями (status='streaming',
agent_ref IS NOT NULL) и финализирует их, когда внешний агент заполнит reply_to
на строке-вопросе.

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

        # Реестр подписок: uid вопроса → {"assistant_message_id": ..., "started": float}
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
        """
        if question_uid in self._subscriptions:
            logger.debug(
                "agent_channel_poller: subscribe no-op, question_uid=%s уже в реестре",
                question_uid,
            )
            return
        self._subscriptions[question_uid] = {
            "assistant_message_id": assistant_message_id,
            "started": self._now(),
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
        """
        from app.domains.chat.services.agent_channel import AgentChannelService

        timeout_sec = self._settings.agent_channel.answer_timeout_sec
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
                if now - entry["started"] >= timeout_sec:
                    await svc.mark_timeout(
                        assistant_message_id=assistant_message_id,
                        question_uid=question_uid,
                    )
                    self.unsubscribe(question_uid)
                    done_count += 1
                    logger.info(
                        "agent_channel_poller: таймаут question_uid=%s, message_id=%s",
                        question_uid,
                        assistant_message_id,
                    )
                else:
                    result = await svc.try_finalize(
                        assistant_message_id=assistant_message_id,
                        question_uid=question_uid,
                    )
                    if result == "done":
                        self.unsubscribe(question_uid)
                        done_count += 1
                        logger.info(
                            "agent_channel_poller: финализирован question_uid=%s, message_id=%s",
                            question_uid,
                            assistant_message_id,
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

        Таймаут восстановленной подписки отсчитывается заново от момента
        reconcile (subscribe ставит started=now()): монотонные часы не
        переживают рестарт, а wall-clock created_at draft'а к ним не привести.
        Уже отвеченные за время простоя draft'ы финализируются на первом же
        тике (try_finalize видит reply_to), так что лишнее ожидание касается
        только реально зависших запросов.
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
