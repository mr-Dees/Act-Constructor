"""
Публичные фабрики ua_data-домена.

Позволяют другим доменам получать конфигурационные объекты ua_data
без прямого импорта UaDataSettings.
"""

from app.core.settings_registry import get as get_domain_settings
from app.domains.ua_data.interfaces import UaInvoiceTableNames
from app.domains.ua_data.settings import UaDataSettings


def make_invoice_table_names() -> UaInvoiceTableNames:
    """
    Создаёт UaInvoiceTableNames из текущих настроек ua_data.

    Вызывается из acts/deps.py при сборке ActInvoiceService.
    Инкапсулирует UaDataSettings внутри ua_data-домена.
    """
    ua = get_domain_settings("ua_data", UaDataSettings)
    return UaInvoiceTableNames(
        violation_metric_dict=ua.violation_metric_dict,
        process_dict=ua.process_dict,
        subsidiary_dict=ua.subsidiary_dict,
    )
