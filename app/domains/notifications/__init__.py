"""Домен центра уведомлений.

Персистентные уведомления (адресные конкретному пользователю и broadcast
всем) со статусами прочитано/скрыто. Колокольчик общий для всех страниц,
поэтому API без доменного гейта — только проверка авторизации.
"""

DOMAIN_NAME = "notifications"


def _build_domain():
    """Ленивое построение DomainDescriptor (вызывается из domain_registry)."""
    from app.core.domain import DomainDescriptor
    from app.domains.notifications._lifecycle import register_factories
    from app.domains.notifications.api import get_api_routers
    from app.domains.notifications.settings import NotificationsSettings

    # Экспортируем фабрики до возврата DomainDescriptor — продьюсеры (acts,
    # chat) разрешают фабрику "notifications.push" через domain_registry.
    register_factories()

    return DomainDescriptor(
        name=DOMAIN_NAME,
        api_routers=get_api_routers(),
        settings_class=NotificationsSettings,
        # Общий колокольчик доступен всем авторизованным пользователям на любой
        # странице — доменный гейт require_domain_access не вешается.
        public_api=True,
    )
