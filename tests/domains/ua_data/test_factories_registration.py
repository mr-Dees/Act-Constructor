"""Регрессия: ua_data регистрирует свои фабрики после discover_domains.

Закрывает п.3 из backend-audit — ck_fin_res/ck_client_exp/acts больше не
импортируют конкретный DictionaryRepository / make_invoice_table_names
из ua_data напрямую, а получают их через ``get_factory(...)``.
"""

from pathlib import Path

import pytest

from app.core import settings_registry
from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import (
    discover_domains,
    get_factory,
    has_factory,
    reset_registry,
)


@pytest.fixture(autouse=True)
def _clean_registries():
    reset_registry()
    settings_registry.reset()
    reset_tools()
    yield
    reset_registry()
    settings_registry.reset()
    reset_tools()


def test_ua_data_factories_registered_after_discover():
    """После discover_domains оба ключа ua_data доступны через get_factory."""
    discover_domains(Path(__file__).parent.parent.parent.parent / "app" / "domains")

    assert has_factory("ua_data.dictionary_repository"), (
        "ua_data.dictionary_repository не зарегистрирована — "
        "ck_fin_res и ck_client_exp не смогут собрать DictionaryService"
    )
    assert has_factory("ua_data.invoice_table_names"), (
        "ua_data.invoice_table_names не зарегистрирована — "
        "acts.get_invoice_service не сможет собрать ActInvoiceService"
    )


def test_invoice_table_names_factory_returns_dataclass():
    """Фабрика возвращает UaInvoiceTableNames с именами трёх таблиц."""
    from app.domains.ua_data.interfaces import UaInvoiceTableNames

    discover_domains(Path(__file__).parent.parent.parent.parent / "app" / "domains")

    result = get_factory("ua_data.invoice_table_names")()
    assert isinstance(result, UaInvoiceTableNames)
    assert result.violation_metric_dict
    assert result.process_dict
    assert result.subsidiary_dict


def test_dictionary_repository_factory_accepts_conn(mock_conn, mock_adapter):
    """Фабрика принимает conn и возвращает объект, соответствующий IDictionaryRepository."""
    from unittest.mock import patch

    from app.domains.ua_data.interfaces import IDictionaryRepository

    discover_domains(Path(__file__).parent.parent.parent.parent / "app" / "domains")

    factory = get_factory("ua_data.dictionary_repository")
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        repo = factory(mock_conn)
    assert isinstance(repo, IDictionaryRepository)
