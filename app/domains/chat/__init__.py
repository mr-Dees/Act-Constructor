"""Домен чата — AI-ассистент с серверной историей и streaming."""

DOMAIN_NAME = "chat"


async def _health_check() -> dict:
    """Health-проверка чата: БД и (если есть) состояние circuit breaker'а LLM.

    Возвращает:
        {"status": "ok"|"degraded"|"error",
         "db": "reachable"|<msg>,
         "llm_circuit": "closed"|"open"|"half_open"|"not_configured"}
    """
    from app.db.connection import get_db

    result: dict = {"status": "ok", "db": "reachable", "llm_circuit": "not_configured"}

    try:
        async with get_db() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:
        return {"status": "error", "db": str(exc), "llm_circuit": "unknown"}

    # Circuit breaker: импорт опциональный — компонент может быть не введён в репо.
    try:
        from app.domains.chat.services.circuit_breaker import get_breaker  # type: ignore

        breaker = get_breaker()
        state = getattr(breaker, "state", None)
        if state is not None:
            state_str = str(state).lower()
            result["llm_circuit"] = state_str
            if "open" in state_str and "half" not in state_str:
                result["status"] = "degraded"
                result["note"] = "primary unreachable, fallback active"
    except ImportError:
        # Circuit breaker ещё не реализован — это не ошибка.
        pass
    except Exception as exc:
        # Поломка breaker'а — degraded, но БД жива.
        result["status"] = "degraded"
        result["llm_circuit"] = f"error: {exc}"

    return result


async def _on_chat_shutdown(app) -> None:
    """Graceful shutdown polling-задач forward'а к внешнему агенту и
    закрытие кэшированных LLM-клиентов (httpx connection pools).

    Без этого SIGTERM рубит ``agent_bridge_runner._running`` посреди
    polling-цикла, ``agent_requests`` могут зависнуть в промежуточном
    статусе. Reconcile при следующем старте подхватит, но мы хотим
    дать задачам ~5с дописать ассистент-сообщение в БД.
    """
    from app.domains.chat.services.agent_bridge_runner import shutdown_running
    from app.domains.chat.services.llm_client import close_cached_clients

    await shutdown_running(timeout_sec=5.0)
    await close_cached_clients()


def _register_lifespan_hooks() -> None:
    """
    Регистрирует startup/shutdown hooks чата в общем lifespan-реестре.

    Хуки поднимают/останавливают:

    * ``chat.tool_metrics_batcher`` — батчер метрик чат-tool'ов
      (записи времени исполнения tool'ов).
    * ``chat.audit_log_batcher`` — батчер audit-лога чата (перенесён
      из ``main.py`` во второй волне рефакторинга).

    Сам ``_on_chat_shutdown`` остаётся на ``DomainDescriptor.on_shutdown`` —
    он работает с polling-задачами форварда, а не с инфраструктурными
    батчерами.
    """
    from fastapi import FastAPI

    from app.core.domain_registry import register_shutdown_hook, register_startup_hook
    from app.core.metrics_batcher import MetricsBatcher
    from app.core.observability_registry import (
        register_background_task,
        register_batcher,
        unregister_background_task,
        unregister_batcher,
    )
    from app.db.connection import get_db
    from app.domains.chat.deps import (
        set_audit_log_batcher,
        set_poll_coordinator,
        set_tool_metrics_batcher,
    )
    from app.domains.chat.repositories.chat_audit_log_repository import (
        ChatAuditLogRecord,
        ChatAuditLogRepository,
    )
    from app.domains.chat.repositories.chat_tool_metrics_repository import (
        ChatToolMetricRecord,
        ChatToolMetricsRepository,
    )

    async def _start_tool_metrics_batcher(app: FastAPI) -> None:
        """Поднимает батчер chat-tool метрик."""
        from app.core.config import get_settings

        obs = get_settings().observability

        async def _flush(records: list[ChatToolMetricRecord]) -> None:
            async with get_db() as conn:
                await ChatToolMetricsRepository(conn).record_many(records)

        batcher = MetricsBatcher(
            flush_callback=_flush,
            max_batch_size=obs.metrics_batch_size,
            flush_interval_sec=obs.metrics_flush_interval_sec,
            max_buffer_size=obs.metrics_max_buffer_size,
            name="chat_tool_metrics",
        )
        await batcher.start()
        set_tool_metrics_batcher(batcher)
        app.state.chat_tool_metrics_batcher = batcher
        register_batcher("chat.tool_metrics_batcher", batcher)

    async def _stop_tool_metrics_batcher(app: FastAPI) -> None:
        """Останавливает батчер chat-tool метрик и сбрасывает ссылку в deps."""
        import logging

        logger = logging.getLogger("audit_workstation.domains.chat.lifecycle")
        batcher = getattr(app.state, "chat_tool_metrics_batcher", None)
        unregister_batcher("chat.tool_metrics_batcher")
        try:
            set_tool_metrics_batcher(None)
        except Exception:
            logger.exception("Не удалось сбросить ссылку на батчер tool-метрик")
        if batcher is not None:
            try:
                await batcher.stop()
            except Exception:
                logger.exception("Ошибка при остановке батчера chat-tool метрик")

    async def _start_audit_log_batcher(app: FastAPI) -> None:
        """Поднимает батчер audit-лога чата."""
        from app.core.config import get_settings

        obs = get_settings().observability

        async def _flush(records: list[ChatAuditLogRecord]) -> None:
            async with get_db() as conn:
                await ChatAuditLogRepository(conn).log_many(records)

        batcher = MetricsBatcher(
            flush_callback=_flush,
            max_batch_size=obs.metrics_batch_size,
            flush_interval_sec=obs.metrics_flush_interval_sec,
            max_buffer_size=obs.metrics_max_buffer_size,
            name="chat_audit_log",
        )
        await batcher.start()
        set_audit_log_batcher(batcher)
        app.state.chat_audit_log_batcher = batcher
        register_batcher("chat.audit_log_batcher", batcher)

    async def _stop_audit_log_batcher(app: FastAPI) -> None:
        """Останавливает батчер audit-лога чата и сбрасывает ссылку в deps."""
        import logging

        logger = logging.getLogger("audit_workstation.domains.chat.lifecycle")
        batcher = getattr(app.state, "chat_audit_log_batcher", None)
        unregister_batcher("chat.audit_log_batcher")
        try:
            set_audit_log_batcher(None)
        except Exception:
            logger.exception("Не удалось сбросить ссылку на батчер audit-лога")
        if batcher is not None:
            try:
                await batcher.stop()
            except Exception:
                logger.exception("Ошибка при остановке батчера audit-лога чата")

    async def _start_poll_coordinator(app: FastAPI) -> None:
        """Поднимает PollCoordinator — единый фоновый цикл polling событий
        внешнего ИИ-агента.

        Координатор подписывается на полный список активных ``request_id``
        и выполняет один SELECT за тик; раннеры читают события из
        ``asyncio.Queue``. Без координатора каждый раннер делал бы
        собственный SELECT/сек на свой ``request_id``.
        """
        from app.core.settings_registry import get as get_domain_settings
        from app.db.connection import get_db
        from app.domains.chat.services.agent_bridge import AgentBridgeService
        from app.domains.chat.services.poll_coordinator import PollCoordinator
        from app.domains.chat.settings import ChatDomainSettings

        chat_settings = get_domain_settings("chat", ChatDomainSettings)
        bridge_settings = chat_settings.agent_bridge

        async def _poll_batch_fn(
            request_ids: list[str],
            since_seqs: dict[str, int | None],
        ) -> dict[str, list[dict]]:
            """Один SELECT по всем активным request_id (новый коннект на тик)."""
            async with get_db() as conn:
                bridge = AgentBridgeService(conn)
                return await bridge.poll_events_batch(
                    request_ids, since_seqs=since_seqs,
                )

        coordinator = PollCoordinator(
            poll_batch_fn=_poll_batch_fn,
            poll_min_interval_sec=bridge_settings.poll_min_interval_sec,
            poll_max_interval_sec=bridge_settings.poll_max_interval_sec,
            poll_backoff_multiplier=bridge_settings.poll_backoff_multiplier,
        )
        await coordinator.start()
        set_poll_coordinator(coordinator)
        app.state.chat_poll_coordinator = coordinator
        register_background_task(
            "chat.poll_coordinator", coordinator.get_status,
        )

    async def _stop_poll_coordinator(app: FastAPI) -> None:
        """Останавливает PollCoordinator и сбрасывает ссылку в deps."""
        import logging

        logger = logging.getLogger("audit_workstation.domains.chat.lifecycle")
        coordinator = getattr(app.state, "chat_poll_coordinator", None)
        unregister_background_task("chat.poll_coordinator")
        try:
            set_poll_coordinator(None)
        except Exception:
            logger.exception("Не удалось сбросить ссылку на PollCoordinator")
        if coordinator is not None:
            try:
                await coordinator.stop()
            except Exception:
                logger.exception("Ошибка при остановке PollCoordinator")

    async def _start_agent_events_cleanup(app: FastAPI) -> None:
        """Поднимает фоновую очистку устаревших agent_response_events.

        Без задачи таблица растёт безгранично: каждый forward пишет
        десятки reasoning-событий, после done они не нужны (финальный
        response в chat_messages, Phase 1 «D»).
        """
        from app.core.settings_registry import get as get_domain_settings
        from app.domains.chat.services.agent_events_cleanup import (
            AgentEventsCleanupTask,
        )
        from app.domains.chat.settings import ChatDomainSettings

        chat_settings = get_domain_settings("chat", ChatDomainSettings)
        bridge_settings = chat_settings.agent_bridge

        task = AgentEventsCleanupTask(
            interval_sec=bridge_settings.agent_events_cleanup_interval_sec,
            ttl_hours=bridge_settings.agent_events_cleanup_ttl_hours,
        )
        await task.start()
        app.state.chat_agent_events_cleanup = task
        register_background_task(
            "chat.agent_events_cleanup", task.get_status,
        )

    async def _stop_agent_events_cleanup(app: FastAPI) -> None:
        """Останавливает фоновую очистку agent_response_events."""
        import logging

        logger = logging.getLogger("audit_workstation.domains.chat.lifecycle")
        task = getattr(app.state, "chat_agent_events_cleanup", None)
        unregister_background_task("chat.agent_events_cleanup")
        if task is not None:
            try:
                await task.stop()
            except Exception:
                logger.exception(
                    "Ошибка при остановке cleanup agent_response_events",
                )

    register_startup_hook("chat.tool_metrics_batcher", _start_tool_metrics_batcher)
    register_shutdown_hook("chat.tool_metrics_batcher", _stop_tool_metrics_batcher)

    register_startup_hook("chat.poll_coordinator", _start_poll_coordinator)
    register_shutdown_hook("chat.poll_coordinator", _stop_poll_coordinator)

    register_startup_hook("chat.audit_log_batcher", _start_audit_log_batcher)
    register_shutdown_hook("chat.audit_log_batcher", _stop_audit_log_batcher)

    register_startup_hook(
        "chat.agent_events_cleanup", _start_agent_events_cleanup,
    )
    register_shutdown_hook(
        "chat.agent_events_cleanup", _stop_agent_events_cleanup,
    )


def _build_domain():
    """Ленивая инициализация домена."""
    from app.core.domain import DomainDescriptor
    from app.domains.chat.api import get_api_routers
    from app.domains.chat.integrations.chat_tools import get_chat_tools
    from app.domains.chat.settings import ChatDomainSettings

    _register_lifespan_hooks()

    return DomainDescriptor(
        name=DOMAIN_NAME,
        api_routers=get_api_routers(),
        html_routers=[],
        settings_class=ChatDomainSettings,
        dependencies={},
        chat_tools=get_chat_tools(),
        on_shutdown=_on_chat_shutdown,
        health_check=_health_check,
    )
