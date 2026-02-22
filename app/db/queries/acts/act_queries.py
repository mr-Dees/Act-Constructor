"""
SQL запросы для извлечения данных актов из PostgreSQL.

Содержит класс ActQueries с методами для получения метаданных актов, структуры дерева,
таблиц, текстовых блоков, нарушений и связанных данных (аудиторская группа, поручения).
Включает вспомогательные методы для навигации по иерархической структуре дерева.
"""

import json

import asyncpg


class ActQueries:
    """
    Набор SQL-запросов для извлечения данных актов из БД.

    Предоставляет методы для получения:
    - Метаданных актов
    - Структуры дерева пунктов
    - Таблиц, текстовых блоков и нарушений
    - Аудиторской группы и поручений
    - Навигации по иерархии пунктов
    """

    # ========================================================================
    # ОСНОВНЫЕ МЕТАДАННЫЕ И СВЯЗАННЫЕ ДАННЫЕ
    # ========================================================================

    @staticmethod
    async def get_act_metadata(conn: asyncpg.Connection, km_number: str) -> dict | None:
        """
        Получает основные метаданные акта по КМ номеру.

        Извлекает запись из таблицы acts со всеми полями: название проверки,
        город, даты, приказ, тип проверки и системные метаданные.

        Args:
            conn: Активное подключение к PostgreSQL.
            km_number: Уникальный КМ номер акта (например, "111", "222").

        Returns:
            Словарь с полями акта или None если акт не найден.
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
        Получает состав аудиторской группы для акта.

        Возвращает список членов группы с их ролями, ФИО, должностями.
        Результат отсортирован по порядку следования (order_index).

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.

        Returns:
            Список словарей с информацией о членах группы.
            Пустой список если группа не указана.
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
        Получает действующие поручения для акта.

        Возвращает список поручений с номерами пунктов и номерами поручений.
        Результат отсортирован по порядку следования (order_index).

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.

        Returns:
            Список словарей с номерами поручений и пунктов.
            Пустой список если поручений нет.
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

    # ========================================================================
    # ДЕРЕВО СТРУКТУРЫ АКТА
    # ========================================================================

    @staticmethod
    async def get_tree(conn: asyncpg.Connection, act_id: int) -> dict | None:
        """
        Получает иерархическое дерево структуры акта.

        Извлекает JSONB дерево из таблицы act_tree. Дерево содержит
        рекурсивную структуру пунктов с вложенными элементами контента
        (таблицы, текстовые блоки, нарушения).

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.

        Returns:
            Словарь с деревом (корневой узел) или None если дерево отсутствует.
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

        # asyncpg может возвращать JSONB как строку или dict
        if isinstance(tree_data, str):
            try:
                return json.loads(tree_data)
            except json.JSONDecodeError:
                return None

        # Если уже распарсен как dict
        return tree_data

    # ========================================================================
    # ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ НАВИГАЦИИ ПО ДЕРЕВУ
    # ========================================================================

    @staticmethod
    def _build_node_id_to_number_map(tree: dict, map_dict: dict = None) -> dict:
        """
        Рекурсивно строит маппинг node_id → number из дерева.

        Обходит дерево и собирает соответствие между внутренними ID узлов
        и их номерами для быстрого поиска.

        Args:
            tree: Корневой узел дерева или любой поддерево.
            map_dict: Аккумулятор для маппинга (используется при рекурсии).

        Returns:
            Словарь {node_id: number}, например {"item-1": "5.1"}.
        """
        if map_dict is None:
            map_dict = {}

        node_id = tree.get('id')
        number = tree.get('number', '')

        # Сохраняем соответствие если есть ID и номер
        if node_id and number:
            map_dict[node_id] = number

        # Рекурсия по дочерним узлам
        for child in tree.get('children', []):
            ActQueries._build_node_id_to_number_map(child, map_dict)

        return map_dict

    @staticmethod
    def _build_node_id_to_hierarchical_number_map(tree: dict) -> dict:
        """
        Строит маппинг node_id → hierarchical_number только для пунктов (item).

        В отличие от _build_node_id_to_number_map, сохраняет только узлы
        типа 'item', игнорируя информационные узлы (table, textblock, violation).

        Args:
            tree: Корневой узел дерева.

        Returns:
            Словарь {node_id: hierarchical_number} для пунктов.
            Например: {"item-5": "5.1.1", "item-6": "5.1.2"}.
        """
        map_dict = {}

        def traverse(node):
            """Внутренняя рекурсивная функция для обхода дерева."""
            node_id = node.get('id')
            number = node.get('number')
            node_type = node.get('type', 'item')

            # Сохраняем только пункты (type == 'item')
            if node_id and number and node_type == 'item':
                map_dict[node_id] = number

            # Рекурсия по детям
            for child in node.get('children', []):
                traverse(child)

        traverse(tree)
        return map_dict

    @staticmethod
    def _find_parent_item_number(tree: dict, target_node_id: str, node_map: dict) -> str | None:
        """
        Находит иерархический номер родительского пункта для узла.

        Для информационных узлов (table, textblock, violation) находит
        ближайший родительский узел типа 'item' и возвращает его номер.

        Пример:
            Если таблица находится в пункте 5.1.1.1, вернет "5.1.1.1".

        Args:
            tree: Корневой узел дерева.
            target_node_id: ID искомого узла (например, "table-123").
            node_map: Маппинг node_id → hierarchical_number для пунктов.

        Returns:
            Hierarchical number родительского пункта (например, "5.1.1.1")
            или None если узел не найден или нет родительского пункта.
        """

        def find_node_and_parent(node, parent_item_number=None):
            """Внутренняя рекурсивная функция."""
            node_id = node.get('id')
            node_type = node.get('type', 'item')

            # Если текущий узел - пункт, обновляем parent_item_number
            if node_type == 'item' and node_id in node_map:
                parent_item_number = node_map[node_id]

            # Если нашли целевой узел - возвращаем текущий parent
            if node_id == target_node_id:
                return parent_item_number

            # Рекурсия по детям
            for child in node.get('children', []):
                result = find_node_and_parent(child, parent_item_number)
                if result is not None:
                    return result

            return None

        return find_node_and_parent(tree)

    # ========================================================================
    # ИЗВЛЕЧЕНИЕ ТАБЛИЦ
    # ========================================================================

    @staticmethod
    async def get_all_tables(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все таблицы акта.

        Извлекает данные из таблицы act_tables с сеткой ячеек и шириной колонок.
        Если передано дерево, корректирует node_number на основе иерархии.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            tree: Дерево структуры акта для маппинга номеров (опционально).

        Returns:
            Список словарей с данными таблиц. JSONB поля распарсены в dict/list.
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

        # Строим маппинг node_id → number из дерева
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Корректируем node_number из дерева если доступно
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Парсим JSONB поля если они в виде строк
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
    async def get_tables_by_item(
            conn: asyncpg.Connection,
            act_id: int,
            item_number: str,
            tree: dict = None,
            recursive: bool = True
    ) -> list[dict]:
        """
        Получает таблицы конкретного пункта акта.

        Фильтрует таблицы по номеру пункта. При recursive=True включает
        таблицы из всех подпунктов.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            item_number: Номер пункта (например, "5.1.2").
            tree: Дерево для точного маппинга node_id → parent_number.
            recursive: Искать ли таблицы в подпунктах.

        Returns:
            Список таблиц, принадлежащих указанному пункту и его подпунктам
            (если recursive=True).
        """
        # Получаем все таблицы акта
        all_tables = await ActQueries.get_all_tables(conn, act_id, tree)

        if not tree:
            # Без дерева: используем node_number напрямую (упрощенная логика)
            result = []
            for table in all_tables:
                node_num = table.get('node_number', '')
                if not node_num:
                    continue

                if recursive:
                    # Совпадение или начинается с item_number.
                    if node_num == item_number or node_num.startswith(f"{item_number}."):
                        result.append(table)
                else:
                    # Только точное совпадение
                    if node_num == item_number:
                        result.append(table)
            return result

        # С деревом: используем маппинг node_id → hierarchical_number
        node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

        result = []
        for table in all_tables:
            node_id = table.get('node_id')
            if not node_id:
                continue

            # Находим родительский пункт таблицы
            parent_number = ActQueries._find_parent_item_number(tree, node_id, node_id_to_number)

            if not parent_number:
                continue

            # Сравниваем с искомым номером
            if recursive:
                if parent_number == item_number or parent_number.startswith(f"{item_number}."):
                    result.append(table)
            else:
                if parent_number == item_number:
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
        Получает таблицу по частичному названию в пункте.

        Выполняет поиск таблицы с названием, содержащим указанную подстроку
        (регистронезависимый поиск).

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            item_number: Номер пункта (например, "5.1.1").
            table_name: Подстрока для поиска в названии таблицы.
            tree: Дерево для маппинга.
            recursive: Искать ли в подпунктах.

        Returns:
            Данные первой найденной таблицы или None.
        """
        # Получаем все таблицы пункта
        tables = await ActQueries.get_tables_by_item(conn, act_id, item_number, tree, recursive)

        # Ищем по названию (case-insensitive)
        search_term = table_name.lower()
        for table in tables:
            label = table.get('table_label', '').lower()
            if search_term in label:
                return table

        return None

    # ========================================================================
    # ИЗВЛЕЧЕНИЕ ТЕКСТОВЫХ БЛОКОВ
    # ========================================================================

    @staticmethod
    async def get_all_textblocks(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все текстовые блоки акта.

        Извлекает данные из таблицы act_textblocks с HTML-содержимым и
        форматированием. Корректирует node_number если передано дерево.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            tree: Дерево структуры для маппинга номеров (опционально).

        Returns:
            Список словарей с данными текстовых блоков.
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

        # Строим маппинг node_id → number
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Корректируем node_number из дерева
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Парсим JSONB поле formatting
            if isinstance(data['formatting'], str):
                try:
                    data['formatting'] = json.loads(data['formatting'])
                except json.JSONDecodeError:
                    data['formatting'] = {}

            result.append(data)

        return result

    @staticmethod
    async def get_textblocks_by_item(
            conn: asyncpg.Connection,
            act_id: int,
            item_number: str,
            tree: dict = None,
            recursive: bool = True
    ) -> list[dict]:
        """
        Получает текстовые блоки конкретного пункта.

        Фильтрует текстовые блоки по номеру пункта. При recursive=True
        включает блоки из всех подпунктов.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            item_number: Номер пункта (например, "5.1").
            tree: Дерево для точного маппинга.
            recursive: Искать ли в подпунктах.

        Returns:
            Список текстовых блоков в указанном пункте и его подпунктах
            (если recursive=True).
        """
        # Получаем все текстовые блоки
        all_textblocks = await ActQueries.get_all_textblocks(conn, act_id, tree)

        if not tree:
            # Без дерева: упрощенная логика по node_number
            result = []
            for textblock in all_textblocks:
                node_num = textblock.get('node_number', '')
                if not node_num:
                    continue

                if recursive:
                    if node_num == item_number or node_num.startswith(f"{item_number}."):
                        result.append(textblock)
                else:
                    if node_num == item_number:
                        result.append(textblock)
            return result

        # С деревом: используем маппинг
        node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

        result = []
        for textblock in all_textblocks:
            node_id = textblock.get('node_id')
            if not node_id:
                continue

            # Находим родительский пункт
            parent_number = ActQueries._find_parent_item_number(tree, node_id, node_id_to_number)

            if not parent_number:
                continue

            # Сравниваем с искомым номером
            if recursive:
                if parent_number == item_number or parent_number.startswith(f"{item_number}."):
                    result.append(textblock)
            else:
                if parent_number == item_number:
                    result.append(textblock)

        return result

    # ========================================================================
    # ИЗВЛЕЧЕНИЕ НАРУШЕНИЙ
    # ========================================================================

    @staticmethod
    async def get_all_violations(conn: asyncpg.Connection, act_id: int, tree: dict = None) -> list[dict]:
        """
        Получает все нарушения акта.

        Извлекает данные из таблицы act_violations со всеми полями:
        violated, established, описания, кейсы, причины, последствия,
        ответственные, рекомендации. Парсит JSONB поля.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            tree: Дерево структуры для маппинга номеров (опционально).

        Returns:
            Список словарей с данными нарушений. JSONB поля распарсены.
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

        # Строим маппинг node_id → number
        node_map = {}
        if tree:
            node_map = ActQueries._build_node_id_to_number_map(tree)

        result = []
        for row in rows:
            data = dict(row)

            # Корректируем node_number из дерева
            if tree and data['node_id'] in node_map:
                data['node_number'] = node_map[data['node_id']]

            # Список JSONB полей для парсинга
            jsonb_fields = [
                'description_list', 'additional_content',
                'reasons', 'consequences', 'responsible', 'recommendations'
            ]

            # Парсим каждое JSONB поле
            for field in jsonb_fields:
                if isinstance(data[field], str):
                    try:
                        data[field] = json.loads(data[field])
                    except json.JSONDecodeError:
                        data[field] = None

            result.append(data)

        return result

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

        Фильтрует нарушения по номеру пункта. При recursive=True включает
        нарушения из всех подпунктов.

        Args:
            conn: Активное подключение к PostgreSQL.
            act_id: Внутренний ID акта в БД.
            item_number: Номер пункта (например, "5.1.1").
            tree: Дерево для точного маппинга.
            recursive: Искать ли в подпунктах.

        Returns:
            Список нарушений в указанном пункте и его подпунктах
            (если recursive=True).
        """
        # Получаем все нарушения
        all_violations = await ActQueries.get_all_violations(conn, act_id, tree)

        if not tree:
            # Без дерева: упрощенная логика
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

        # С деревом: используем маппинг
        node_id_to_number = ActQueries._build_node_id_to_hierarchical_number_map(tree)

        result = []
        for violation in all_violations:
            node_id = violation.get('node_id')
            if not node_id:
                continue

            # Находим родительский пункт
            parent_number = ActQueries._find_parent_item_number(tree, node_id, node_id_to_number)

            if not parent_number:
                continue

            # Сравниваем с искомым номером
            if recursive:
                if parent_number == item_number or parent_number.startswith(f"{item_number}."):
                    result.append(violation)
            else:
                if parent_number == item_number:
                    result.append(violation)

        return result
