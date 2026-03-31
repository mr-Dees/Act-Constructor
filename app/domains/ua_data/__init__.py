"""Домен общих справочных данных (UA)."""

DOMAIN_NAME = "ua_data"


def _build_domain():
    """Ленивое построение DomainDescriptor."""
    from app.core.domain import DomainDescriptor

    return DomainDescriptor(
        name=DOMAIN_NAME,
        dependencies=["admin"],
    )
