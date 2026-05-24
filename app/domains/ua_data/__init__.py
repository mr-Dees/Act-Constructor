"""Домен общих справочных данных (UA)."""

DOMAIN_NAME = "ua_data"


def _build_domain():
    """Ленивое построение DomainDescriptor."""
    from app.core.domain import DomainDescriptor
    from app.domains.ua_data._lifecycle import register_factories
    from app.domains.ua_data.settings import UaDataSettings

    # Экспортируем фабрики до возврата DomainDescriptor — потребители
    # (acts.deps, ck_fin_res.deps, ck_client_exp.deps) разрешают их через
    # domain_registry.get_factory(...) по ключам ua_data.*.
    register_factories()

    return DomainDescriptor(
        name=DOMAIN_NAME,
        settings_class=UaDataSettings,
        dependencies={
            "admin": "проверки доступа require_domain_access опираются на таблицу roles, создаваемую админ-доменом",
        },
        chat_system_prompt=(
            "У тебя есть доступ к справочным данным UA: список подразделений "
            "и контрагентов."
        ),
    )
