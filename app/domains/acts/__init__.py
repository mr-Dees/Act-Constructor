"""
Домен актов.

Содержит всю бизнес-логику, связанную с актами:
CRUD, блокировки, содержимое, экспорт, фактуры.

Импорты API/routes/lifecycle — lazy, чтобы избежать
циклических импортов при загрузке settings из config.py.
"""


def _build_domain():
    """Ленивое построение DomainDescriptor (вызывается из domain_registry)."""
    from app.core.domain import DomainDescriptor, KnowledgeBase, NavItem
    from app.domains.acts.api import get_api_routers
    from app.domains.acts.routes import get_html_routers
    from app.domains.acts._lifecycle import on_shutdown
    from app.domains.acts.settings import ActsSettings
    from app.domains.acts.integrations.chat_tools import get_chat_tools

    return DomainDescriptor(
        name="acts",
        api_routers=get_api_routers(),
        html_routers=get_html_routers(),
        settings_class=ActsSettings,
        on_shutdown=on_shutdown,
        chat_tools=get_chat_tools(),
        nav_items=[
            NavItem(
                label="Управление актами",
                url="/acts",
                icon_svg=(
                    '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 '
                    '012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 '
                    '01.293.707V19a2 2 0 01-2 2z" '
                    'stroke="currentColor" stroke-width="2" '
                    'stroke-linecap="round" stroke-linejoin="round"/>'
                ),
                order=10,
                active_page="acts",
                chat_domains=["acts"],
                group="Аудит",
            ),
        ],
        knowledge_bases=[
            KnowledgeBase(
                key="knowledge_base_oarb",
                label="База Знаний ОАРБ",
                description="Поиск по базе знаний отдела аудита розничного бизнеса",
            ),
            KnowledgeBase(
                key="knowledge_base_sources",
                label="База знаний источников информации",
                description="Поиск по каталогу источников данных",
            ),
            KnowledgeBase(
                key="knowledge_base_tools",
                label="База знаний по инструментам",
                description="Поиск по документации инструментов",
            ),
        ],
        chat_system_prompt=(
            "Ты — AI-ассистент для работы с актами аудита. "
            "Акты имеют древовидную структуру с 5 разделами: "
            "1) Общая информация, 2) Оценка качества, 3) Источники данных, "
            "4) Выводы, 5) Отчётные таблицы. "
            "КМ-номера имеют формат КМ-XX-XXXXX. "
            "Служебные записки — формат Текст/ГГГГ. "
            "Используй доступные инструменты для получения данных из актов."
        ),
    )
