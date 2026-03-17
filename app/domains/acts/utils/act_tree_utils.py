"""
Утилиты обхода дерева структуры акта.
"""


class ActTreeUtils:
    """Stateless-утилиты для рекурсивного обхода дерева акта."""

    @staticmethod
    def extract_node_number(tree: dict, node_id: str, current_node: dict = None) -> str | None:
        """Рекурсивно извлекает номер узла из дерева."""
        if current_node is None:
            current_node = tree

        if current_node.get('id') == node_id:
            return current_node.get('number')

        for child in current_node.get('children', []):
            result = ActTreeUtils.extract_node_number(tree, node_id, child)
            if result:
                return result

        return None

    @staticmethod
    def find_node_label(tree: dict, node_id: str, current_node: dict = None) -> str | None:
        """Рекурсивно ищет метку узла в дереве."""
        if current_node is None:
            current_node = tree

        if current_node.get('id') == node_id:
            return current_node.get('label')

        for child in current_node.get('children', []):
            result = ActTreeUtils.find_node_label(tree, node_id, child)
            if result:
                return result

        return None

    @staticmethod
    def find_parent_item_node_id(
        tree: dict,
        target_node_id: str,
        current_node: dict = None,
        parent_item_id: str | None = None
    ) -> str | None:
        """
        Находит ID ближайшего родительского item-узла для данного узла.

        Для content-узлов (table/textblock/violation) возвращает ID
        родительского item-узла, чей auditPointId следует использовать.
        """
        if current_node is None:
            current_node = tree

        node_type = current_node.get('type', 'item')

        # Обновляем parent_item_id если текущий узел — item
        if node_type == 'item' or node_type not in ('table', 'textblock', 'violation'):
            current_item_id = current_node.get('id')
        else:
            current_item_id = parent_item_id

        if current_node.get('id') == target_node_id:
            # Если это content-узел — возвращаем parent_item_id
            if node_type in ('table', 'textblock', 'violation'):
                return parent_item_id
            # Если это item-узел — возвращаем его собственный id
            return current_node.get('id')

        for child in current_node.get('children', []):
            result = ActTreeUtils.find_parent_item_node_id(
                tree, target_node_id, child, current_item_id
            )
            if result:
                return result

        return None

    @staticmethod
    def calculate_tree_depth(tree: dict, current_depth: int = 0) -> int:
        """
        Рекурсивно вычисляет максимальную глубину дерева.

        Args:
            tree: Узел дерева с полем 'children'
            current_depth: Текущая глубина (для рекурсии)

        Returns:
            Максимальная глубина дерева
        """
        children = tree.get('children', [])
        if not children:
            return current_depth

        max_child_depth = current_depth
        for child in children:
            child_depth = ActTreeUtils.calculate_tree_depth(child, current_depth + 1)
            max_child_depth = max(max_child_depth, child_depth)

        return max_child_depth
