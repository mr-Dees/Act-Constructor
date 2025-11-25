"""
SQL запросы для извлечения данных актов.
"""

import json

import asyncpg


class ActQueries:
    """Запросы к БД для получения данных актов."""

    @staticmethod
    async def get_act_metadata(conn: asyncpg.Connection, km_number: str) -> dict | None:
        """
        Получает метаданные акта по КМ.

        Args:
            conn: Подключение к БД
            km_number: Номер КМ

        Returns:
            Метаданные акта или None
        """
        row = await conn.fetchrow(
            """
            SELECT *
            FROM acts
            WHERE km_number = $1
            """,
            km_number
        )

        return dict(row) if row else None

    @staticmethod
    async def get_audit_team(conn: asyncpg.Connection, act_id: int) -> list[dict]:
        """
        Получает состав аудиторской группы.

        Args:
            conn: Подключение к БД
            act_id: ID акта

        Returns:
            Список членов группы
        """
        rows = await conn.fetch(
            """
            SELECT role, full_name, position, username
            FROM audit_team_members
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id
        )

        return [dict(row) for row in rows]

    @staticmethod
    async def get_directives(conn: asyncpg.Connection, act_id: int) -> list[dict]:
        """
        Получает действующие поручения.

        Args:
            conn: Подключение к БД
            act_id: ID акта

        Returns:
            Список поручений
        """
        rows = await conn.fetch(
            """
            SELECT point_number, directive_number
            FROM act_directives
            WHERE act_id = $1
            ORDER BY order_index
            """,
            act_id
        )

        return [dict(row) for row in rows]

    @staticmethod
    async def get_tree(conn: asyncpg.Connection, act_id: int) -> dict | None:
        """
        Получает дерево структуры акта.

        Args:
            conn: Подключение к БД
            act_id: ID акта

        Returns:
            JSONB дерево или None
        """
        row = await conn.fetchrow(
            """
            SELECT tree_data
            FROM act_tree
            WHERE act_id = $1
            """,
            act_id
        )

        if not row:
            return None

        tree_data = row['tree_data']

        # Парсим если это строка JSON
        if isinstance(tree_data, str):
            try:
                return json.loads(tree_data)
            except json.JSONDecodeError:
                return None

        # Если уже dict (asyncpg автоматически парсит JSONB)
        return tree_data

    @staticmethod
    def _build_node_id_to_number_map(tree: dict, map_dict: dict = None) -> dict:
        """
        Рекурсивно строит маппинг node_id -> number из дерева.

        Args:
            tree: Дерево или узел
            map_dict: Аккумулятор для маппинга

        Returns:
            Словарь {node_id: number}
        """
        if map_dict is None:
            map_dict = {}

        node_id = tree.get('id')
        number = tree.get('number', '')

        if node_id and number:
            map_dict[node_id] = number

        for child in tree.get('children', []):
            ActQueries._build_node_id_to_number_map(child, map_dict)

        return map_dict

    @staticmethod
    async def get_all_tables(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все таблицы акта.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            tree: Дерево для получения правильных номеров (опционально)

        Returns:
            Список таблиц
        """
        rows = await conn.fetch(
            """
            SELECT table_id, node_id, node_number, table_label, grid_data, col_widths
            FROM act_tables
            WHERE act_id = $1
            ORDER BY node_number NULLS LAST
            """,
            act_id
        )

        # Строим маппинг node_id -> number из дерева
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Исправляем node_number из дерева если нужно
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Парсим JSONB поля если нужно
            if isinstance(data['grid_data'], str):
                try:
                    data['grid_data'] = json.loads(data['grid_data'])
                except json.JSONDecodeError:
                    data['grid_data'] = []

            if isinstance(data['col_widths'], str):
                try:
                    data['col_widths'] = json.loads(data['col_widths'])
                except json.JSONDecodeError:
                    data['col_widths'] = []

            result.append(data)

        return result

    @staticmethod
    async def get_all_textblocks(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все текстовые блоки акта.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            tree: Дерево для получения правильных номеров

        Returns:
            Список текстовых блоков
        """
        rows = await conn.fetch(
            """
            SELECT textblock_id, node_id, node_number, content, formatting
            FROM act_textblocks
            WHERE act_id = $1
            ORDER BY node_number NULLS LAST
            """,
            act_id
        )

        # Строим маппинг node_id -> number
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Исправляем node_number из дерева
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Парсим formatting если нужно
            if isinstance(data['formatting'], str):
                try:
                    data['formatting'] = json.loads(data['formatting'])
                except json.JSONDecodeError:
                    data['formatting'] = {}

            result.append(data)

        return result

    @staticmethod
    async def get_all_violations(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все нарушения акта.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            tree: Дерево для получения правильных номеров

        Returns:
            Список нарушений
        """
        rows = await conn.fetch(
            """
            SELECT 
                violation_id, node_id, node_number, violated, established,
                description_list, additional_content, reasons, consequences,
                responsible, recommendations
            FROM act_violations
            WHERE act_id = $1
            ORDER BY node_number NULLS LAST
            """,
            act_id
        )

        # Строим маппинг node_id -> number
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Исправляем node_number из дерева
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Список JSONB полей для проверки
            jsonb_fields = [
                'description_list', 'additional_content',
                'reasons', 'consequences', 'responsible', 'recommendations'
            ]

            for field in jsonb_fields:
                if isinstance(data[field], str):
                    try:
                        data[field] = json.loads(data[field])
                    except json.JSONDecodeError:
                        data[field] = None

            result.append(data)

        return result

    @staticmethod
    async def get_tables_by_item(
            conn: asyncpg.Connection,
            act_id: int,
            item_number: str,
            tree: dict = None,
            recursive: bool = True
    ) -> list[dict]:
        """
        Получает таблицы конкретного пункта.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            item_number: Номер пункта (например, "5.1.2")
            tree: Дерево для маппинга node_id -> number
            recursive: Искать в подпунктах

        Returns:
            Список таблиц в пункте и его подпунктах
        """
        # Получаем все таблицы с правильными номерами
        all_tables = await ActQueries.get_all_tables(conn, act_id, tree)

        # Фильтруем по номеру
        result = []
        for table in all_tables:
            node_num = table.get('node_number', '')

            if not node_num:
                continue

            # Точное совпадение или начинается с item_number.
            if recursive:
                if node_num == item_number or node_num.startswith(f"{item_number}."):
                    result.append(table)
            else:
                # Только точное совпадение
                if node_num == item_number:
                    result.append(table)

        return result

    @staticmethod
    async def get_table_by_name(
            conn: asyncpg.Connection,
            act_id: int,
            item_number: str,
            table_name: str,
            tree: dict = None,
            recursive: bool = True
    ) -> dict | None:
        """
        Получает таблицу по названию в пункте.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            item_number: Номер пункта
            table_name: Название таблицы (частичное совпадение)
            tree: Дерево для маппинга
            recursive: Искать в подпунктах

        Returns:
            Данные таблицы или None
        """
        tables = await ActQueries.get_tables_by_item(conn, act_id, item_number, tree, recursive)

        # Ищем по названию (ILIKE)
        for table in tables:
            label = table.get('table_label', '').lower()
            if table_name.lower() in label:
                return table

        return None

    @staticmethod
    async def get_violations_by_item(
            conn: asyncpg.Connection,
            act_id: int,
            item_number: str,
            tree: dict = None,
            recursive: bool = True
    ) -> list[dict]:
        """
        Получает нарушения конкретного пункта.

        Args:
            conn: Подключение к БД
            act_id: ID акта
            item_number: Номер пункта
            tree: Дерево для маппинга
            recursive: Искать в подпунктах

        Returns:
            Список нарушений в пункте и его подпунктах
        """
        # Получаем все нарушения с правильными номерами
        all_violations = await ActQueries.get_all_violations(conn, act_id, tree)

        # Фильтруем по номеру
        result = []
        for violation in all_violations:
            node_num = violation.get('node_number', '')

            if not node_num:
                continue

            if recursive:
                if node_num == item_number or node_num.startswith(f"{item_number}."):
                    result.append(violation)
            else:
                if node_num == item_number:
                    result.append(violation)

        return result
