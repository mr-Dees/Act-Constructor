"""
Валидация ссылок поручений на пункты акта.
"""

import logging
from typing import Iterable

from app.schemas.act_metadata import ActDirective

logger = logging.getLogger("act_constructor.db.utils.validator")


class ActDirectivesValidator:
    """Проверка корректности ссылок поручений на пункты дерева акта."""

    @staticmethod
    def collect_node_numbers(tree: dict) -> set[str]:
        """Рекурсивно собирает все номера узлов из дерева."""
        numbers: set[str] = set()

        def _walk(node: dict) -> None:
            if not isinstance(node, dict):
                logger.warning(
                    "Узел дерева не является dict: %s (value=%r)",
                    type(node),
                    node,
                )
                return

            number = node.get("number")
            if number:
                numbers.add(number)

            children = node.get("children")
            if isinstance(children, list):
                for child in children:
                    _walk(child)

        _walk(tree)
        return numbers

    @staticmethod
    def validate_directives_points(
            directives: Iterable[ActDirective],
            existing_points: set[str],
    ) -> None:
        """
        Проверяет, что:
        - все пункты из поручений лежат в разделе 5.*
        - все указанные пункты существуют в дереве.

        Raises:
            ValueError: Если поручение ссылается на некорректный или несуществующий пункт.
        """
        for directive in directives:
            point = directive.point_number

            if not point.startswith("5."):
                raise ValueError(
                    f"Поручение '{directive.directive_number}' ссылается на пункт "
                    f"'{point}', но поручения могут быть только в разделе 5"
                )

            if point not in existing_points:
                raise ValueError(
                    f"Поручение '{directive.directive_number}' ссылается на "
                    f"несуществующий пункт '{point}'. Сначала создайте этот "
                    f"пункт в структуре акта."
                )

    @staticmethod
    def build_audit_point_map(tree: dict) -> dict[str, str | None]:
        """
        Строит маппинг {node_id -> auditPointId} обходом дерева.

        Для item-узлов берёт auditPointId из самого узла.
        """
        result: dict[str, str | None] = {}

        def _walk(node: dict) -> None:
            node_type = node.get('type', 'item')
            if node_type == 'item' or node_type not in ('table', 'textblock', 'violation'):
                audit_point_id = node.get('auditPointId')
                if audit_point_id:
                    result[node.get('id')] = audit_point_id
            for child in node.get('children', []):
                _walk(child)

        _walk(tree)
        return result
