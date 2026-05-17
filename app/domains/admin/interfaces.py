"""
Публичные интерфейсы домена admin.

Потребители других доменов зависят от этих Protocol-интерфейсов,
а не от конкретных классов или настроек admin-домена напрямую.
"""

from typing import Protocol, runtime_checkable


@runtime_checkable
class IUserDirectory(Protocol):
    """Доступ к справочнику пользователей. Реализация — внутри admin-домена."""

    async def search_users(self, query: str, limit: int = 20) -> list[dict]:
        """Поиск пользователей по ФИО (ILIKE) или логину (LIKE)."""
        ...
