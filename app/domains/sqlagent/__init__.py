"""Домен SQL-агента (Text-to-SQL).

Регистрирует портал-страницу со встроенным через iframe родным UI SQLAgent,
который работает отдельным uvicorn-процессом, и пункт навигации в сайдбаре.
"""

DOMAIN_NAME = "sqlagent"


def _build_domain():
    """Ленивое построение DomainDescriptor."""
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.sqlagent.routes import get_html_routers
    from app.domains.sqlagent.settings import SQLAgentSettings

    return DomainDescriptor(
        name=DOMAIN_NAME,
        html_routers=get_html_routers(),
        settings_class=SQLAgentSettings,
        nav_items=[
            NavItem(
                label="SQL-агент",
                url="/sqlagent",
                icon_svg=(
                    '<path d="M4 7c0-1.66 3.58-3 8-3s8 1.34 8 3-3.58 3-8 '
                    '3-8-1.34-8-3zm0 0v5c0 1.66 3.58 3 8 3s8-1.34 8-3V7M4 '
                    '12v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5" '
                    'stroke="currentColor" stroke-width="2" '
                    'stroke-linecap="round" stroke-linejoin="round"/>'
                ),
                order=30,
                active_page="sqlagent",
                group="Аналитика",
                description="Генерация SQL по запросу на естественном языке (Text-to-SQL)",
            ),
        ],
    )
