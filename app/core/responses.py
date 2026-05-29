"""Общие схемы ответов API.

Содержит generic-обёртку для пагинированных списков ``PaginatedResponse[T]``.
Все list-эндпоинты унифицированы под этот shape: ``{items, total, limit, offset}``.
"""

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Унифицированный ответ list-эндпоинтов.

    Поля:
        items: страница результатов (limit штук, начиная с offset).
        total: общее количество записей под текущим фильтром.
        limit: размер запрошенной страницы (для удобства клиента).
        offset: смещение запрошенной страницы.
    """

    items: list[T]
    total: int
    limit: int
    offset: int
