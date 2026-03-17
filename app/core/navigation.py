"""
Навигация: сбор NavItem и сквозных данных из всех зарегистрированных доменов.

Sidebar формируется динамически — домены декларируют свои NavItem,
а шаблон рендерит их в порядке NavItem.order.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.domain import KnowledgeBase, NavItem


def get_nav_items() -> list[NavItem]:
    """Собирает NavItem из всех доменов, сортирует по order."""
    from app.core.domain_registry import get_all_domains

    items: list[NavItem] = []
    for d in get_all_domains():
        items.extend(d.nav_items)
    return sorted(items, key=lambda x: x.order)


def get_chat_domains_for_page(active_page: str) -> list[str] | None:
    """
    Возвращает список доменов для фильтрации chat tools по active_page.

    Ищет NavItem с совпадающим active_page и возвращает его chat_domains.
    Для landing (active_page="landing") возвращает None (все tools).
    """
    if active_page == "landing":
        return None

    from app.core.domain_registry import get_all_domains

    for d in get_all_domains():
        for nav in d.nav_items:
            if nav.active_page == active_page and nav.chat_domains:
                return nav.chat_domains
    return None


def get_nav_items_grouped() -> list[dict]:
    """Собирает NavItem сгруппированные по group. Возвращает [{group, items}]."""
    items = get_nav_items()
    groups: dict[str, list[NavItem]] = {}
    for item in items:
        g = item.group or ""
        groups.setdefault(g, []).append(item)
    return [{"group": group_name, "nav_items": group_items} for group_name, group_items in groups.items()]


def get_knowledge_bases() -> list[KnowledgeBase]:
    """Собирает KnowledgeBase из всех доменов."""
    from app.core.domain_registry import get_all_domains

    bases: list[KnowledgeBase] = []
    for d in get_all_domains():
        bases.extend(d.knowledge_bases)
    return bases


def get_knowledge_bases_as_dicts() -> list[dict]:
    """Собирает KnowledgeBase как список dict (для JSON-сериализации в шаблонах)."""
    from dataclasses import asdict
    return [asdict(kb) for kb in get_knowledge_bases()]
