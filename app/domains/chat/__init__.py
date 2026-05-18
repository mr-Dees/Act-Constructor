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


def _build_domain():
    """Ленивая инициализация домена."""
    from app.core.domain import DomainDescriptor
    from app.domains.chat.api import get_api_routers
    from app.domains.chat.integrations.chat_tools import get_chat_tools
    from app.domains.chat.settings import ChatDomainSettings

    return DomainDescriptor(
        name=DOMAIN_NAME,
        api_routers=get_api_routers(),
        html_routers=[],
        settings_class=ChatDomainSettings,
        dependencies=[],
        chat_tools=get_chat_tools(),
        on_shutdown=_on_chat_shutdown,
        health_check=_health_check,
    )
