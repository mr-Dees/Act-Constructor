"""
Общие утилиты для модулей извлечения данных актов.

Содержит:
- ActContext — async context manager для получения акта и дерева из БД
- Batch-обёртки для пакетной обработки по КМ и по пунктам
- Вспомогательные функции для работы с деревом и форматированием
"""

from typing import Dict, List

from app.db.connection import get_pool, get_adapter
from app.domains.acts.integrations.ai_assistant.queries.act_queries import ActQueries
from app.domains.acts.integrations.ai_assistant.queries.act_filters import ActFilters
from app.domains.acts.integrations.ai_assistant.formatters.ai_readable_formatter import ActFormatter


class ActContext:
    """
    Async context manager для получения акта и дерева из БД.

    Инкапсулирует повторяющийся паттерн: pool → conn → act → tree.

    Использование::

        async with ActContext(km_number) as ctx:
            if ctx.error:
                return ctx.error
            # ctx.conn, ctx.act, ctx.tree доступны
    """

    def __init__(self, km_number: str):
        self.km_number = km_number
        self.conn = None
        self.act = None
        self.tree = None
        self.error = None
        self.queries = None
        self.filters = None
        self._pool = None
        self._conn_ctx = None

    async def __aenter__(self):
        self._pool = get_pool()
        self._conn_ctx = self._pool.acquire()
        self.conn = await self._conn_ctx.__aenter__()

        adapter = get_adapter()
        self.queries = ActQueries(adapter)
        self.filters = ActFilters(adapter)

        self.act = await self.queries.get_act_metadata(self.conn, self.km_number)
        if not self.act:
            self.error = f"Акт с КМ {self.km_number} не найден."
            return self

        self.tree = await self.queries.get_tree(self.conn, self.act['id'])
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._conn_ctx:
            await self._conn_ctx.__aexit__(exc_type, exc_val, exc_tb)
        return False


def build_node_map(tree: dict) -> dict:
    """Строит маппинг node_id → hierarchical_number для пунктов (item)."""
    return ActQueries._build_node_id_to_hierarchical_number_map(tree)


def find_parent_number(tree: dict, node_id: str, node_map: dict) -> str | None:
    """Находит иерархический номер родительского пункта для узла."""
    return ActQueries._find_parent_item_number(tree, node_id, node_map)


def assemble_parts(parts: list[str], separator: str = "\n\n") -> str:
    """Собирает непустые части текста через разделитель."""
    return separator.join(p for p in parts if p.strip())


def prepend_metadata(parts: list[str], act: dict, with_metadata: bool) -> None:
    """Добавляет метаданные акта в начало списка частей, если требуется."""
    if with_metadata:
        parts.append(ActFormatter.format_metadata(act))


def find_node_by_number(tree: dict, number: str) -> dict | None:
    """Рекурсивный поиск узла дерева по номеру."""
    node_num = tree.get('number', '').rstrip('.')
    search_num = number.rstrip('.')

    if node_num == search_num:
        return tree

    for child in tree.get('children', []):
        res = find_node_by_number(child, number)
        if res is not None:
            return res

    return None


async def batch_over_km(km_numbers: List[str], func, **kwargs) -> Dict[str, str]:
    """
    Пакетная обработка по списку КМ номеров.

    Вызывает func(km, **kwargs) для каждого КМ последовательно.
    """
    result = {}
    for km in km_numbers:
        result[km] = await func(km, **kwargs)
    return result


async def batch_over_items(
        km_number: str,
        items: List[str],
        func,
        **kwargs
) -> Dict[str, str]:
    """
    Пакетная обработка по списку пунктов одного акта.

    Вызывает func(km_number, item, **kwargs) для каждого пункта последовательно.
    """
    result = {}
    for item in items:
        result[item] = await func(km_number, item, **kwargs)
    return result
