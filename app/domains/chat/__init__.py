"""Домен чата — AI-ассистент с серверной историей и streaming."""

DOMAIN_NAME = "chat"


async def _on_chat_shutdown(app) -> None:
    """Graceful shutdown polling-задач forward'а к внешнему агенту.

    Без этого SIGTERM рубит ``agent_bridge_runner._running`` посреди
    polling-цикла, ``agent_requests`` могут зависнуть в промежуточном
    статусе. Reconcile при следующем старте подхватит, но мы хотим
    дать задачам ~5с дописать ассистент-сообщение в БД.
    """
    from app.domains.chat.services.agent_bridge_runner import shutdown_running
    await shutdown_running(timeout_sec=5.0)


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
    )
