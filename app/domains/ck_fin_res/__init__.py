"""Домен ЦК Фин.Рез. (заглушка)."""

DOMAIN_NAME = "ck_fin_res"


def _build_domain():
    """Ленивое построение DomainDescriptor."""
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.ck_fin_res.routes import get_html_routers

    return DomainDescriptor(
        name=DOMAIN_NAME,
        html_routers=get_html_routers(),
        nav_items=[
            NavItem(
                label="ЦК Фин.Рез.",
                url="/ck-fin-res",
                icon_svg=(
                    '<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 '
                    '002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 '
                    '2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 '
                    '012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" '
                    'stroke="currentColor" stroke-width="2" '
                    'stroke-linecap="round" stroke-linejoin="round"/>'
                ),
                order=20,
                active_page="ck_fin_res",
                chat_domains=[DOMAIN_NAME, "acts"],
                group="Центры компетенций",
            ),
        ],
    )
