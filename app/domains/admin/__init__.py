"""
Домен администрирования.

Управление ролями пользователей, справочник пользователей,
начальное заполнение ролей при первом запуске.
"""


def _build_domain():
    """Ленивое построение DomainDescriptor (вызывается из domain_registry)."""
    from app.core.domain import DomainDescriptor
    from app.domains.admin.api import get_api_routers
    from app.domains.admin.routes import get_html_routers
    from app.domains.admin._lifecycle import on_startup
    from app.core import settings_registry
    from app.domains.admin.settings import AdminSettings

    return DomainDescriptor(
        name="admin",
        api_routers=get_api_routers(),
        html_routers=get_html_routers(),
        settings_class=AdminSettings,
        on_startup=on_startup,
        migration_substitutions={
            "{REF_USER_TABLE}": lambda: settings_registry.get("admin", AdminSettings).user_directory.table,
        },
    )
