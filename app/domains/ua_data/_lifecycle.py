"""Жизненный цикл домена ua_data."""

import logging

import asyncpg

logger = logging.getLogger("audit_workstation.domains.ua_data.lifecycle")


def register_factories() -> None:
    """
    Регистрирует фабрики, экспортируемые ua_data-доменом для других доменов.

    Потребители (acts, ck_fin_res, ck_client_exp) разрешают фабрики через
    ``domain_registry.get_factory(...)`` и зависят от Protocol-интерфейсов
    (``IDictionaryRepository``, ``UaInvoiceTableNames``), а не от
    конкретных классов внутри ua_data.

    Контракт фабрик:

    * ``ua_data.dictionary_repository(conn)`` — принимает открытое соединение
      asyncpg, возвращает реализацию ``IDictionaryRepository``. Так потребитель
      делит коннект с собственными репозиториями (одна транзакция, один acquire
      из пула на запрос).
    * ``ua_data.invoice_table_names()`` — без аргументов, возвращает
      ``UaInvoiceTableNames`` (имена справочных таблиц для фактур).

    Вызывается на этапе сборки DomainDescriptor (``_build_domain``) — это
    гарантирует, что фабрики доступны до старта lifespan'а потребителей.
    Идемпотентна: повторный вызов перезаписывает фабрики.
    """
    from app.core.domain_registry import register_factory
    from app.domains.ua_data.factories import make_invoice_table_names
    from app.domains.ua_data.repositories.dictionary_repository import (
        DictionaryRepository,
    )

    def _dictionary_repository_factory(conn: asyncpg.Connection):
        """Создаёт DictionaryRepository поверх переданного соединения."""
        return DictionaryRepository(conn)

    register_factory("ua_data.dictionary_repository", _dictionary_repository_factory)
    register_factory("ua_data.invoice_table_names", make_invoice_table_names)
