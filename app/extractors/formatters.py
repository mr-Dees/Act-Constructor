"""
Форматирование данных в человекочитаемый вид.
"""

import json
from typing import Any


class ActFormatter:
    """Форматирование данных акта для AI-ассистента."""

    @staticmethod
    def format_tree_structure(tree: dict, stats: dict = None, level: int = 0) -> str:
        """
        Выводит структуру дерева акта.

        Логика:
        - БЕЗ статистики (stats=None): только номера и названия пунктов (item)
        - СО статистикой (stats!=None): пункты + элементы в квадратных скобках + статистика в конце

        Args:
            tree: Корневой узел или поддерево
            stats: {'tables': ..., 'textblocks': ..., 'violations': ...} или None
            level: Рекурсивный уровень (используется внутренне)

        Returns:
            Человекочитаемый список пунктов с отступами/нумерацией
        """
        # БЕЗ статистики - только пункты
        if stats is None:
            return ActFormatter._format_structure_simple(tree, level)

        # СО статистикой - пункты + элементы + статистика В КОНЦЕ
        lines = ActFormatter._format_structure_with_elements(tree, level)

        # Добавляем статистику ОДИН РАЗ в самом конце (только на уровне 0)
        if level == 0:
            lines.append("")  # Пустая строка перед статистикой
            lines.append(f"Всего таблиц: {stats.get('tables', 0)}")
            lines.append(f"Всего текстовых блоков: {stats.get('textblocks', 0)}")
            lines.append(f"Всего нарушений: {stats.get('violations', 0)}")

        return '\n'.join(lines)

    @staticmethod
    def _format_structure_simple(node: dict, level: int = 0) -> str:
        """
        Форматирует структуру БЕЗ элементов (только пункты).

        Args:
            node: Узел дерева
            level: Уровень вложенности

        Returns:
            Отформатированная строка
        """
        lines = []
        indent = '  ' * level

        # Пропускаем информационные узлы
        if node.get('type') in ['table', 'textblock', 'violation']:
            return ''

        # Выводим только пункты
        label = node.get('label', '')
        if label and node.get('id') != 'root':
            lines.append(f"{indent}{label}")

        # Рекурсия по детям
        for child in node.get('children', []):
            child_result = ActFormatter._format_structure_simple(
                child,
                level + 1 if node.get('id') != 'root' else level
            )
            if child_result:
                lines.append(child_result)

        return '\n'.join(lines)

    @staticmethod
    def _format_structure_with_elements(node: dict, level: int = 0) -> list:
        """
        Форматирует структуру С элементами в квадратных скобках.

        Возвращает список строк (а не строку), чтобы избежать дублирования
        при рекурсивных вызовах.

        Args:
            node: Узел дерева
            level: Уровень вложенности

        Returns:
            Список строк (без join)
        """
        lines = []
        indent = '  ' * level

        # Информационные узлы - в квадратных скобках
        if node.get('type') == 'table':
            number = node.get('number', 'Таблица')
            custom_label = node.get('customLabel', '')
            if custom_label:
                lines.append(f"{indent}[{number}] {custom_label}")
            else:
                lines.append(f"{indent}[{number}]")
            return lines

        if node.get('type') == 'textblock':
            number = node.get('number', 'Текстовый блок')
            lines.append(f"{indent}[{number}]")
            return lines

        if node.get('type') == 'violation':
            number = node.get('number', 'Нарушение')
            lines.append(f"{indent}[{number}]")
            return lines

        # Для пунктов - обычный вывод
        label = node.get('label', '')
        if label and node.get('id') != 'root':
            lines.append(f"{indent}{label}")

        # Рекурсия по детям
        for child in node.get('children', []):
            child_lines = ActFormatter._format_structure_with_elements(
                child,
                level + 1 if node.get('id') != 'root' else level
            )
            lines.extend(child_lines)  # extend вместо append

        return lines

    @staticmethod
    def format_metadata(act_row: dict) -> str:
        """
        Форматирует метаданные акта.

        Args:
            act_row: Строка из таблицы acts

        Returns:
            Отформатированные метаданные
        """
        lines = [
            f"КМ: {act_row['km_number']}",
            f"Проверка: {act_row['inspection_name']}",
            f"Город: {act_row['city']}",
            f"Дата акта: {act_row['created_date']}",
            f"Приказ: {act_row['order_number']} от {act_row['order_date']}",
            f"Период проверки: с {act_row['inspection_start_date']} по {act_row['inspection_end_date']}",
            f"Тип проверки: {'Процессная' if act_row['is_process_based'] else 'Функциональная'}"
        ]

        return '\n'.join(lines)

    @staticmethod
    def format_audit_team(team_members: list[dict]) -> str:
        """
        Форматирует состав аудиторской группы.

        Args:
            team_members: Список членов группы

        Returns:
            Отформатированный список
        """
        if not team_members:
            return "Аудиторская группа: не указана"

        lines = ["Аудиторская группа:"]

        for member in team_members:
            role = member['role']
            name = member['full_name']
            position = member['position']
            lines.append(f"  {role}: {name} ({position})")

        return '\n'.join(lines)

    @staticmethod
    def format_directives(directives: list[dict]) -> str:
        """
        Форматирует действующие поручения.

        Args:
            directives: Список поручений

        Returns:
            Отформатированный список
        """
        if not directives:
            return ""

        lines = ["Действующие поручения:"]

        for directive in directives:
            point = directive['point_number']
            number = directive['directive_number']
            lines.append(f"  Пункт {point}: {number}")

        return '\n'.join(lines)

    @staticmethod
    def _has_merged_cells(grid: list[list[dict]]) -> bool:
        """
        Проверяет наличие объединенных ячеек в таблице.

        Args:
            grid: Сетка ячеек

        Returns:
            True если есть объединенные ячейки
        """
        for row in grid:
            for cell in row:
                if cell.get('colSpan', 1) > 1 or cell.get('rowSpan', 1) > 1:
                    return True
        return False

    @staticmethod
    def format_table(table_data: dict, node_number: str = "") -> str:
        """
        Форматирует таблицу в Markdown или текстовое представление.

        Args:
            table_data: Данные таблицы из БД
            node_number: Номер узла в дереве

        Returns:
            Отформатированная таблица
        """
        grid = json.loads(table_data['grid_data']) if isinstance(table_data['grid_data'], str) else table_data[
            'grid_data']
        label = table_data.get('table_label', '')

        lines = []

        # Заголовок таблицы
        if label:
            lines.append(f"\n{label}")
        elif node_number:
            lines.append(f"\nТаблица (пункт {node_number})")
        else:
            lines.append("\nТаблица")

        if not grid or len(grid) == 0:
            lines.append("(пустая таблица)")
            return '\n'.join(lines)

        # Определяем тип таблицы для специальной обработки
        is_metrics_table = label and 'Объем выявленных отклонений' in label
        is_operational_risk_table = label and 'операционного риска' in label

        # Для специальных таблиц всегда используем упрощенный Markdown
        if is_metrics_table or is_operational_risk_table:
            markdown_rows = ActFormatter._build_markdown_rows(
                grid,
                is_metrics_table=is_metrics_table,
                is_operational_risk_table=is_operational_risk_table
            )
            if markdown_rows:
                lines.extend(markdown_rows)
            else:
                lines.append("(таблица без данных)")
            return '\n'.join(lines)

        # Для обычных таблиц выбираем формат в зависимости от наличия объединений
        has_merges = ActFormatter._has_merged_cells(grid)

        if has_merges:
            # Текстовое представление для таблиц с объединениями
            text_rows = ActFormatter._build_text_representation(grid)
            lines.extend(text_rows)
        else:
            # Markdown для простых таблиц
            markdown_rows = ActFormatter._build_simple_markdown(grid)
            if markdown_rows:
                lines.extend(markdown_rows)
            else:
                lines.append("(таблица без данных)")

        return '\n'.join(lines)

    @staticmethod
    def _build_simple_markdown(grid: list[list[dict]]) -> list[str]:
        """
        Строит Markdown таблицу для таблиц БЕЗ объединенных ячеек.

        Args:
            grid: Сетка ячеек

        Returns:
            Список строк Markdown
        """
        if not grid:
            return []

        rows = []

        for row_idx, row in enumerate(grid):
            cells = [cell.get('content', '').strip() for cell in row]

            if not cells:
                continue

            # Формируем Markdown строку
            row_str = '| ' + ' | '.join(cells) + ' |'
            rows.append(row_str)

            # Добавляем разделитель после первой строки
            if row_idx == 0:
                separator = '| ' + ' | '.join(['---'] * len(cells)) + ' |'
                rows.append(separator)

        return rows

    @staticmethod
    def _build_text_representation(grid: list[list[dict]]) -> list[str]:
        """
        Строит текстовое представление таблицы с объединенными ячейками.

        Args:
            grid: Сетка ячеек

        Returns:
            Список строк текстового представления
        """
        if not grid:
            return []

        lines = []

        for row_idx, row in enumerate(grid):
            lines.append(f"\nСтрока {row_idx + 1}:")

            for col_idx, cell in enumerate(row):
                # Пропускаем spanned ячейки
                if cell.get('isSpanned'):
                    continue

                content = cell.get('content', '').strip()
                colspan = cell.get('colSpan', 1)
                rowspan = cell.get('rowSpan', 1)
                is_header = cell.get('isHeader', False)

                # Формируем описание ячейки
                cell_type = "Заголовок" if is_header else "Ячейка"

                # Описание позиции и объединения
                if colspan > 1 and rowspan > 1:
                    position = f"[{row_idx},{col_idx}-{col_idx + colspan - 1}] (строки {row_idx}-{row_idx + rowspan - 1})"
                elif colspan > 1:
                    position = f"[{row_idx},{col_idx}-{col_idx + colspan - 1}]"
                elif rowspan > 1:
                    position = f"[{row_idx}-{row_idx + rowspan - 1},{col_idx}]"
                else:
                    position = f"[{row_idx},{col_idx}]"

                lines.append(f"  {cell_type} {position}: {content}")

        return lines

    @staticmethod
    def _build_markdown_rows(
            grid: list[list[dict]],
            is_metrics_table: bool = False,
            is_operational_risk_table: bool = False
    ) -> list[str]:
        """
        Строит строки Markdown для специальных таблиц (метрики, операционные риски).

        Args:
            grid: Сетка ячеек таблицы
            is_metrics_table: Таблица метрик
            is_operational_risk_table: Таблица операционных рисков

        Returns:
            Список строк Markdown
        """
        if not grid:
            return []

        rows = []

        # Специальная обработка для таблицы метрик
        if is_metrics_table and len(grid) >= 2:
            # Упрощенная шапка в одну строку
            simplified_header = [
                'Код метрики',
                'Наименование метрики',
                'Количество клиентов / элементов (ФЛ), ед.',
                'Количество клиентов / элементов (ЮЛ), ед.',
                'Сумма, руб.',
                'Код БП',
                'Пункт / подпункт акта'
            ]

            row_str = '| ' + ' | '.join(simplified_header) + ' |'
            rows.append(row_str)

            separator = '| ' + ' | '.join(['---'] * len(simplified_header)) + ' |'
            rows.append(separator)

            # Строки данных (пропускаем первые 2 строки заголовка)
            for row_idx in range(2, len(grid)):
                row = grid[row_idx]
                cells = []

                for cell in row:
                    if cell.get('isSpanned'):
                        continue
                    content = cell.get('content', '').strip()
                    cells.append(content)

                if cells:
                    row_str = '| ' + ' | '.join(cells) + ' |'
                    rows.append(row_str)

            return rows

        # Специальная обработка для таблицы операционных рисков
        if is_operational_risk_table and len(grid) >= 2:
            # Используем только вторую строку заголовка, разбиваем объединенную ячейку
            second_row = grid[1]
            simplified_header = []

            for cell in second_row:
                if cell.get('isSpanned'):
                    continue

                content = cell.get('content', '').strip()

                # Разбиваем "Подтип и сумма последствия" на две колонки
                if 'Подтип и сумма последствия' in content or (
                        cell.get('colSpan', 1) > 1 and cell.get('originCol') == 4
                ):
                    simplified_header.append('Подтип последствия')
                    simplified_header.append('Сумма последствия')
                else:
                    simplified_header.append(content)

            row_str = '| ' + ' | '.join(simplified_header) + ' |'
            rows.append(row_str)

            separator = '| ' + ' | '.join(['---'] * len(simplified_header)) + ' |'
            rows.append(separator)

            # Строки данных (пропускаем первые 2 строки заголовка)
            for row_idx in range(2, len(grid)):
                row = grid[row_idx]
                cells = []

                for cell in row:
                    if cell.get('isSpanned'):
                        continue
                    content = cell.get('content', '').strip()
                    cells.append(content)

                if cells:
                    row_str = '| ' + ' | '.join(cells) + ' |'
                    rows.append(row_str)

            return rows

        return []

    @staticmethod
    def format_textblock(textblock_data: dict, parent_item_number: str = "") -> str:
        """
        Форматирует текстовый блок.

        Args:
            textblock_data: Данные текстового блока
            parent_item_number: Иерархический номер родительского пункта (например, "5.1.1")

        Returns:
            Отформатированный текст
        """
        content = textblock_data.get('content', '').strip()

        if not content:
            return ""

        # Удаляем HTML теги для чистого текста
        clean_content = ActFormatter._strip_html(content)

        lines = []

        if parent_item_number:
            lines.append(f"\nТекстовый блок (пункт {parent_item_number}):")
        else:
            lines.append("\nТекстовый блок:")

        lines.append(clean_content)

        return '\n'.join(lines)

    @staticmethod
    def _strip_html(html: str) -> str:
        """
        Удаляет HTML теги из текста.

        Args:
            html: HTML строка

        Returns:
            Чистый текст
        """
        import re

        # Заменяем <br> на переносы
        text = re.sub(r'<br\s*/?>', '\n', html)

        # Удаляем все HTML теги
        text = re.sub(r'<[^>]+>', '', text)

        # Декодируем HTML entities
        import html as html_module
        text = html_module.unescape(text)

        return text.strip()

    @staticmethod
    def format_violation(violation_data: dict, parent_item_number: str = "") -> str:
        """
        Форматирует нарушение.

        Args:
            violation_data: Данные нарушения
            parent_item_number: Иерархический номер родительского пункта (например, "5.1.1.1")

        Returns:
            Отформатированное нарушение
        """
        lines = []

        # Заголовок
        if parent_item_number:
            lines.append(f"\nНарушение (пункт {parent_item_number})")
        else:
            lines.append("\nНарушение")

        lines.append("─" * 50)

        # Основные поля
        violated = violation_data.get('violated', '').strip()
        established = violation_data.get('established', '').strip()

        if violated:
            lines.append(f"Нарушено: {violated}")

        if established:
            lines.append(f"Установлено: {established}")

        # Список описаний
        description_list = ActFormatter._parse_json_field(violation_data.get('description_list'))
        if description_list and description_list.get('enabled'):
            items = description_list.get('items', [])
            if items:
                lines.append("\nОписание:")
                for idx, item in enumerate(items, 1):
                    lines.append(f"  {idx}. {item}")

        # Дополнительный контент
        additional_content = ActFormatter._parse_json_field(violation_data.get('additional_content'))
        if additional_content and additional_content.get('enabled'):
            items = additional_content.get('items', [])
            if items:
                lines.append("\nКейсы и изображения:")
                for idx, item in enumerate(items, 1):
                    item_type = item.get('type', 'unknown')

                    if item_type == 'case':
                        content = item.get('content', '')
                        lines.append(f"  Кейс {idx}: {content}")

                    elif item_type == 'image':
                        caption = item.get('caption', 'Без подписи')
                        filename = item.get('filename', 'unknown')
                        lines.append(f"  Изображение {idx}: {caption} (файл: {filename})")

                    elif item_type == 'freeText':
                        content = item.get('content', '')
                        lines.append(f"  Текст {idx}: {content}")

        # Опциональные поля
        optional_fields = [
            ('reasons', 'Причины'),
            ('consequences', 'Последствия'),
            ('responsible', 'Ответственные'),
            ('recommendations', 'Рекомендации')
        ]

        for field_name, label in optional_fields:
            field_data = ActFormatter._parse_json_field(violation_data.get(field_name))
            if field_data and field_data.get('enabled'):
                content = field_data.get('content', '').strip()
                if content:
                    lines.append(f"\n{label}: {content}")

        return '\n'.join(lines)

    @staticmethod
    def _parse_json_field(field: Any) -> dict | None:
        """
        Парсит JSONB поле из БД.

        Args:
            field: JSONB поле

        Returns:
            Распарсенный dict или None
        """
        if field is None:
            return None

        if isinstance(field, dict):
            return field

        if isinstance(field, str):
            try:
                return json.loads(field)
            except json.JSONDecodeError:
                return None

        return None

    @staticmethod
    def format_tree_item(
            node: dict,
            tree_data: dict,
            tables: list[dict],
            textblocks: list[dict],
            violations: list[dict],
            level: int = 0,
            max_depth: int | None = None,
            parent_item_number: str = ""
    ) -> str:
        """
        Рекурсивно форматирует элемент дерева со всем содержимым.

        Args:
            node: Узел дерева
            tree_data: Полное дерево для навигации
            tables: Все таблицы акта
            textblocks: Все текстовые блоки акта
            violations: Все нарушения акта
            level: Текущий уровень вложенности
            max_depth: Максимальная глубина рекурсии (None - без ограничений)
            parent_item_number: Иерархический номер родительского пункта

        Returns:
            Отформатированный текст пункта
        """
        # Проверка глубины: если превышен лимит, не обрабатываем детей
        process_children = (max_depth is None) or (level < max_depth)

        lines = []
        indent = "  " * level

        # Заголовок пункта
        node_type = node.get('type', 'item')
        label = node.get('label', '')
        number = node.get('number', '')

        # Обновляем parent_item_number для дочерних элементов
        current_item_number = parent_item_number
        if node_type == 'item' and number:
            current_item_number = number

        if node_type == 'item':
            if label:
                lines.append(f"{indent}{label}")

            # Содержимое пункта
            content = node.get('content', '').strip()
            if content:
                lines.append(f"{indent}  {content}")

        elif node_type == 'table':
            table_id = node.get('tableId')
            if table_id:
                table = next((t for t in tables if t['table_id'] == table_id), None)
                if table:
                    # Передаем parent_item_number вместо number
                    formatted = ActFormatter.format_table(table, current_item_number)
                    for line in formatted.split('\n'):
                        lines.append(f"{indent}{line}")

        elif node_type == 'textblock':
            textblock_id = node.get('textBlockId')
            if textblock_id:
                textblock = next((tb for tb in textblocks if tb['textblock_id'] == textblock_id), None)
                if textblock:
                    # Передаем parent_item_number вместо number
                    formatted = ActFormatter.format_textblock(textblock, current_item_number)
                    for line in formatted.split('\n'):
                        lines.append(f"{indent}{line}")

        elif node_type == 'violation':
            violation_id = node.get('violationId')
            if violation_id:
                violation = next((v for v in violations if v['violation_id'] == violation_id), None)
                if violation:
                    # Передаем parent_item_number вместо number
                    formatted = ActFormatter.format_violation(violation, current_item_number)
                    for line in formatted.split('\n'):
                        lines.append(f"{indent}{line}")

        # Рекурсивная обработка дочерних элементов (только если не превышена глубина)
        if process_children:
            children = node.get('children', [])
            for child in children:
                child_formatted = ActFormatter.format_tree_item(
                    child,
                    tree_data,
                    tables,
                    textblocks,
                    violations,
                    level + 1,
                    max_depth,
                    current_item_number  # Передаем текущий номер пункта
                )
                if child_formatted:
                    lines.append(child_formatted)

        return '\n'.join(lines)
