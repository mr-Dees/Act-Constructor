"""Тесты для дескриптора домена (NavItem, DomainDescriptor)."""

from app.core.domain import NavItem


def test_navitem_description_default_empty():
    """По умолчанию NavItem.description — пустая строка."""
    item = NavItem(label="Тест", url="/x", icon_svg="<svg/>")
    assert item.description == ""


def test_navitem_with_description():
    """NavItem принимает description как именованный аргумент."""
    item = NavItem(
        label="Тест",
        url="/x",
        icon_svg="<svg/>",
        description="Короткое описание страницы",
    )
    assert item.description == "Короткое описание страницы"
