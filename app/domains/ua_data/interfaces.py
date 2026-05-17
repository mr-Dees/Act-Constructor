"""
Публичные интерфейсы домена ua_data.

Потребители других доменов зависят от этих Protocol-интерфейсов и dataclass-ов,
а не от DictionaryRepository или UaDataSettings напрямую.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@runtime_checkable
class IDictionaryRepository(Protocol):
    """Чтение справочников ua_data. Реализация — DictionaryRepository внутри ua_data-домена."""

    async def get_processes(self) -> list[dict]:
        """Возвращает список актуальных процессов."""
        ...

    async def get_terbanks(self) -> list[dict]:
        """Возвращает список актуальных территориальных банков."""
        ...

    async def get_metric_codes(self) -> list[dict]:
        """Возвращает список актуальных метрик нарушений."""
        ...

    async def get_departments(self) -> list[dict]:
        """Возвращает список актуальных подразделений."""
        ...

    async def get_channels(self) -> list[dict]:
        """Возвращает список актуальных каналов."""
        ...

    async def get_products(self) -> list[dict]:
        """Возвращает список актуальных продуктов."""
        ...

    async def get_risk_types(self) -> list[dict]:
        """Возвращает список актуальных типов риска."""
        ...

    async def get_teams(self) -> list[dict]:
        """Возвращает список актуальных команд аудита."""
        ...


@dataclass(frozen=True)
class UaInvoiceTableNames:
    """
    Имена таблиц ua_data, необходимых для фактур актов.

    Конструируется в acts/deps.py из UaDataSettings — acts-домен
    не знает о UaDataSettings напрямую.
    """
    violation_metric_dict: str
    process_dict: str
    subsidiary_dict: str
