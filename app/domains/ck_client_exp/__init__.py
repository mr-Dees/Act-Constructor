"""Домен ЦК Клиентский опыт (заглушка)."""


def _build_domain():
    """Ленивое построение DomainDescriptor."""
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.ck_client_exp.routes import get_html_routers

    return DomainDescriptor(
        name="ck_client_exp",
        html_routers=get_html_routers(),
        nav_items=[
            NavItem(
                label="ЦК Клиентский опыт",
                url="/ck-client-experience",
                icon_svg=(
                    '<path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 '
                    '0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 '
                    '015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 '
                    '0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" '
                    'stroke="currentColor" stroke-width="2" '
                    'stroke-linecap="round" stroke-linejoin="round"/>'
                ),
                order=30,
                active_page="ck_client_experience",
                chat_domains=["ck_client_exp", "acts"],
                group="Центры компетенций",
            ),
        ],
    )
