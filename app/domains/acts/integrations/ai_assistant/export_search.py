"""Поиск и фильтрация актов по различным критериям."""

from datetime import date
from typing import List, Optional

from app.db.connection import get_pool
from app.domains.acts.integrations.ai_assistant.queries.act_filters import ActFilters


async def search_acts(
        inspection_names: Optional[List[str]] = None,
        cities: Optional[List[str]] = None,
        created_date_from: Optional[date] = None,
        created_date_to: Optional[date] = None,
        order_date_from: Optional[date] = None,
        order_date_to: Optional[date] = None,
        inspection_start_from: Optional[date] = None,
        inspection_start_to: Optional[date] = None,
        inspection_end_from: Optional[date] = None,
        inspection_end_to: Optional[date] = None,
        directive_numbers: Optional[List[str]] = None,
        with_metadata: bool = True
) -> str:
    """
    Поиск актов по набору фильтров.

    Выполняет гибкий поиск актов в БД с использованием различных критериев.
    Все текстовые фильтры поддерживают частичное совпадение (ILIKE).

    Args:
        inspection_names: Список названий проверок для поиска.
        cities: Список городов для фильтрации.
        created_date_from: Минимальная дата составления акта.
        created_date_to: Максимальная дата составления акта.
        order_date_from: Минимальная дата приказа.
        order_date_to: Максимальная дата приказа.
        inspection_start_from: Минимальная дата начала проверки.
        inspection_start_to: Максимальная дата начала проверки.
        inspection_end_from: Минимальная дата окончания проверки.
        inspection_end_to: Максимальная дата окончания проверки.
        directive_numbers: Список номеров поручений для поиска.
        with_metadata: Включать ли подробные метаданные в результаты.

    Returns:
        Отформатированный список найденных актов.
    """
    pool = get_pool()

    async with pool.acquire() as conn:
        results = await ActFilters.search_acts(
            conn,
            inspection_names=inspection_names,
            cities=cities,
            created_date_from=created_date_from,
            created_date_to=created_date_to,
            order_date_from=order_date_from,
            order_date_to=order_date_to,
            inspection_start_from=inspection_start_from,
            inspection_start_to=inspection_start_to,
            inspection_end_from=inspection_end_from,
            inspection_end_to=inspection_end_to,
            directive_numbers=directive_numbers,
            with_metadata=with_metadata
        )

        return ActFilters.format_search_results(results, with_metadata)
