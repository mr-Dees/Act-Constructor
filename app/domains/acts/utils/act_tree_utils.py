"""
Утилиты обхода дерева структуры акта.
"""


class ActTreeUtils:
    """Stateless-утилиты для итеративного обхода дерева акта."""

    @staticmethod
    def extract_node_number(tree: dict, node_id: str, current_node: dict = None) -> str | None:
        """Извлекает номер узла из дерева (итеративный обход)."""
        stack = [current_node if current_node is not None else tree]
        while stack:
            node = stack.pop()
            if node.get('id') == node_id:
                return node.get('number')
            stack.extend(node.get('children', []))
        return None

    @staticmethod
    def find_node_label(tree: dict, node_id: str, current_node: dict = None) -> str | None:
        """Ищет метку узла в дереве (итеративный обход)."""
        stack = [current_node if current_node is not None else tree]
        while stack:
            node = stack.pop()
            if node.get('id') == node_id:
                return node.get('label')
            stack.extend(node.get('children', []))
        return None

    @staticmethod
    def find_parent_item_node_id(
        tree: dict,
        target_node_id: str,
        current_node: dict = None,
        parent_item_id: str | None = None
    ) -> str | None:
        """
        Находит ID ближайшего родительского item-узла (итеративный обход).

        Для content-узлов (table/textblock/violation) возвращает ID
        родительского item-узла, чей auditPointId следует использовать.
        """
        # Элементы стека: (node, parent_item_id)
        start = current_node if current_node is not None else tree
        stack = [(start, parent_item_id)]
        while stack:
            node, p_item_id = stack.pop()
            node_type = node.get('type', 'item')

            # Обновляем parent_item_id если текущий узел — item
            if node_type == 'item' or node_type not in ('table', 'textblock', 'violation'):
                current_item_id = node.get('id')
            else:
                current_item_id = p_item_id

            if node.get('id') == target_node_id:
                # Если это content-узел — возвращаем parent_item_id
                if node_type in ('table', 'textblock', 'violation'):
                    return p_item_id
                # Если это item-узел — возвращаем его собственный id
                return node.get('id')

            for child in node.get('children', []):
                stack.append((child, current_item_id))
        return None

    @staticmethod
    def calculate_tree_depth(tree: dict, current_depth: int = 0) -> int:
        """
        Вычисляет максимальную глубину дерева (итеративный обход).

        Args:
            tree: Узел дерева с полем 'children'
            current_depth: Начальная глубина

        Returns:
            Максимальная глубина дерева
        """
        max_depth = current_depth
        # Элементы стека: (node, depth)
        stack = [(tree, current_depth)]
        while stack:
            node, depth = stack.pop()
            children = node.get('children', [])
            if not children:
                max_depth = max(max_depth, depth)
            else:
                for child in children:
                    stack.append((child, depth + 1))
        return max_depth
