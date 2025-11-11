"""
Форматер для текстового представления актов.

Преобразует структуру акта в простой текстовый формат (plain text)
с ASCII-таблицами и отступами для иерархии.
"""

import html
import re
from typing import Dict, List

from app.formatters.base_formatter import BaseFormatter


class TextFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в текстовый формат.

    Создает читаемое текстовое представление с использованием
    ASCII-графики для таблиц и отступов для передачи структуры.
    """

    # Константы для настройки форматирования
    HEADER_WIDTH = 80
    INDENT_SIZE = 2
    DEFAULT_FONT_SIZE = 14
    DEFAULT_ALIGNMENT = 'left'

    def __init__(self):
        """Инициализация текстового форматера с пустыми хранилищами."""
        # Хранилища для быстрого доступа к связанным сущностям
        self.violations: Dict = {}
        self.textBlocks: Dict = {}
        self.tables: Dict = {}

    def format(self, data: Dict) -> str:
        """
        Форматирует данные акта в plain text.

        Args:
            data: Словарь с данными акта:
                - tree: древовидная структура
                - tables: словарь таблиц
                - textBlocks: словарь текстовых блоков
                - violations: словарь нарушений

        Returns:
            str: Отформатированный текст акта
        """
        result = []

        # Сохраняем ссылки на вложенные структуры для доступа при рекурсии
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Заголовок документа с декоративным обрамлением
        result.append("=" * self.HEADER_WIDTH)
        result.append("АКТ".center(self.HEADER_WIDTH))
        result.append("=" * self.HEADER_WIDTH)
        result.append("")

        # Обработка дерева структуры акта
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        # Рекурсивная обработка каждого пункта верхнего уровня
        for item in root_children:
            result.append(self._format_item(item, level=0))

        return "\n".join(result)

    def _format_item(self, item: Dict, level: int = 0) -> str:
        """
        Рекурсивно форматирует пункт акта с учетом вложенности.

        Args:
            item: Словарь с данными пункта (узла дерева)
            level: Уровень вложенности (используется для отступов)

        Returns:
            str: Отформатированный пункт со всеми дочерними элементами
        """
        lines = []
        indent = " " * (self.INDENT_SIZE * level)

        # Извлечение метаданных пункта
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Заголовок пункта с подчеркиванием (кроме textblock и violation)
        if label and item_type not in ['textblock', 'violation']:
            lines.append(f"{indent}{label}")
            lines.append(f"{indent}{'-' * len(label)}")

        # Текстовое содержание пункта
        content = item.get('content', '')
        if content:
            lines.append(f"{indent}{content}")
            lines.append("")

        # Обработка связанной таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            lines.append(self._format_table(self.tables[table_id], level))
            lines.append("")

        # Обработка текстового блока
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            lines.append(self._format_textblock(self.textBlocks[textblock_id], level))
            lines.append("")

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            formatted_violation = self._format_violation(self.violations[violation_id])
            # Применяем отступ к каждой строке нарушения
            for line in formatted_violation.split('\n'):
                lines.append(f"{indent}{line}")
            lines.append("")

        # Рекурсивная обработка дочерних элементов
        children = item.get('children', [])
        for child in children:
            lines.append(self._format_item(child, level + 1))

        return "\n".join(lines)

    def _format_table(self, table_data: Dict, level: int = 0) -> str:
        """
        Форматирует таблицу в ASCII-графику с матричной структурой grid.

        Создает псевдографическую таблицу с рамками и разделителями.
        Обрабатывает объединение ячеек (colSpan/rowSpan).

        Args:
            table_data: Словарь с данными таблицы (grid)
            level: Уровень вложенности для отступов

        Returns:
            str: ASCII-таблица с рамками
        """
        indent = " " * (self.INDENT_SIZE * level)
        grid = table_data.get('grid', [])

        if not grid:
            return f"{indent}[Пустая таблица]"

        # Построение матрицы отображения
        display_matrix = self._build_display_matrix(grid)

        if not display_matrix:
            return f"{indent}[Пустая таблица]"

        # Вычисление ширины колонок
        col_widths = self._calculate_column_widths(display_matrix)

        # Построение ASCII-таблицы
        lines = []
        separator = self._draw_separator(col_widths, indent)

        lines.append(separator)  # Верхняя граница

        for idx, row in enumerate(display_matrix):
            lines.append(self._draw_row(row, col_widths, indent))
            # Разделитель после заголовка (первой строки)
            if idx == 0:
                lines.append(separator)

        lines.append(separator)  # Нижняя граница

        return "\n".join(lines)

    def _build_display_matrix(self, grid: List[List[Dict]]) -> List[List[str]]:
        """Строит матрицу отображения из grid-структуры"""
        display_matrix = []
        max_cols = 0

        for row_data in grid:
            display_row = []
            for cell_data in row_data:
                if cell_data.get('isSpanned', False):
                    continue

                content = str(cell_data.get('content', ''))
                colspan = cell_data.get('colSpan', 1)

                display_row.append(content)
                # Пустые ячейки для colspan
                for _ in range(colspan - 1):
                    display_row.append('')

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        # Выравнивание всех строк
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        return display_matrix

    def _calculate_column_widths(self, matrix: List[List[str]]) -> List[int]:
        """Вычисляет оптимальную ширину колонок"""
        if not matrix:
            return []

        num_cols = len(matrix[0])
        col_widths = [0] * num_cols

        for row in matrix:
            for col_idx, cell_text in enumerate(row):
                col_widths[col_idx] = max(col_widths[col_idx], len(str(cell_text)))

        return col_widths

    def _draw_separator(self, col_widths: List[int], indent: str) -> str:
        """Создает горизонтальный разделитель таблицы"""
        parts = ['-' * (width + 2) for width in col_widths]
        return f"{indent}+{'+'.join(parts)}+"

    def _draw_row(self, row: List[str], col_widths: List[int], indent: str) -> str:
        """Создает строку таблицы с содержимым ячеек"""
        row_parts = []
        for col_idx, width in enumerate(col_widths):
            cell_text = str(row[col_idx]) if col_idx < len(row) else ''
            row_parts.append(f" {cell_text.ljust(width)} ")
        return f"{indent}|{'|'.join(row_parts)}|"

    def _format_textblock(self, textblock_data: Dict, level: int = 0) -> str:
        """
        Форматирует текстовый блок с очисткой HTML и применением отступов.

        Args:
            textblock_data: Словарь с содержимым и параметрами форматирования
            level: Уровень вложенности для отступов

        Returns:
            str: Отформатированный текстовый блок
        """
        indent = " " * (self.INDENT_SIZE * level)
        content = textblock_data.get('content', '')

        if not content:
            return ""

        formatting = textblock_data.get('formatting', {})

        # Очистка HTML
        clean_content = self._clean_html(content)

        # Применение отступов к каждой строке
        lines = clean_content.split('\n')
        formatted_lines = [f"{indent}{line}" for line in lines]

        # Добавление метаданных о форматировании
        result = []
        meta = self._build_formatting_meta(formatting)
        if meta:
            result.append(f"{indent}[{', '.join(meta)}]")

        result.extend(formatted_lines)
        return "\n".join(result)

    def _clean_html(self, content: str) -> str:
        """Очищает HTML-теги и декодирует сущности"""
        # Замена <br> на переносы строк
        clean_content = re.sub(r'<br\s*/?>', '\n', content, flags=re.IGNORECASE)

        # Удаление всех HTML-тегов
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        # Декодирование HTML-сущностей
        return html.unescape(clean_content)

    def _build_formatting_meta(self, formatting: Dict) -> List[str]:
        """Создает список метаданных о форматировании"""
        meta = []
        font_size = formatting.get('fontSize', self.DEFAULT_FONT_SIZE)
        alignment = formatting.get('alignment', self.DEFAULT_ALIGNMENT)

        if font_size != self.DEFAULT_FONT_SIZE:
            meta.append(f"размер шрифта: {font_size}px")

        if alignment == 'center':
            meta.append("выравнивание: по центру")
        elif alignment == 'right':
            meta.append("выравнивание: по правому краю")
        elif alignment == 'justify':
            meta.append("выравнивание: по ширине")

        return meta

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение с всеми секциями.

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            str: Отформатированное нарушение
        """
        lines = []

        # Основные секции
        self._add_labeled_section(lines, "Нарушено", violation_data.get('violated', ''))
        self._add_labeled_section(lines, "Установлено", violation_data.get('established', ''))

        # Список описаний
        self._add_description_list(lines, violation_data.get('descriptionList', {}))

        # Дополнительный контент
        self._add_additional_content(lines, violation_data.get('additionalContent', {}))

        # Опциональные поля
        self._add_labeled_section(lines, "Причины", violation_data.get('reasons', {}))
        self._add_labeled_section(lines, "Последствия", violation_data.get('consequences', {}))
        self._add_labeled_section(lines, "Ответственные", violation_data.get('responsible', {}))

        return "\n".join(lines)

    def _add_labeled_section(self, lines: List[str], label: str, data):
        """Добавляет секцию с меткой"""
        if isinstance(data, dict):
            if not data.get('enabled', False):
                return
            content = data.get('content', '')
        else:
            content = data

        if content:
            lines.append(f"{label}: {content}")
            lines.append("")

    def _add_description_list(self, lines: List[str], desc_list: Dict):
        """Добавляет список описаний с маркерами"""
        if not desc_list.get('enabled', False):
            return

        items = desc_list.get('items', [])
        if not items:
            return

        lines.append("Описание:")
        for item in items:
            if item.strip():
                lines.append(f"  • {item}")
        lines.append("")

    def _add_additional_content(self, lines: List[str], additional_content: Dict):
        """Добавляет дополнительный контент"""
        if not additional_content.get('enabled', False):
            return

        items = additional_content.get('items', [])
        case_number = 1

        for item in items:
            item_type = item.get('type')

            if item_type == 'case':
                case_number = self._add_case(lines, item, case_number)
            elif item_type == 'image':
                self._add_image(lines, item)
                case_number = 1
            elif item_type == 'freeText':
                self._add_free_text(lines, item)
                case_number = 1

    def _add_case(self, lines: List[str], item: Dict, case_number: int) -> int:
        """Добавляет кейс с номером"""
        content = item.get('content', '')
        if content:
            lines.append(f"Кейс {case_number}: {content}")
            lines.append("")
            return case_number + 1
        return case_number

    def _add_image(self, lines: List[str], item: Dict):
        """Добавляет ссылку на изображение"""
        caption = item.get('caption', '')
        filename = item.get('filename', '')

        if caption:
            lines.append(f"Изображение: {filename} - {caption}")
        else:
            lines.append(f"Изображение: {filename}")
        lines.append("")

    def _add_free_text(self, lines: List[str], item: Dict):
        """Добавляет свободный текст"""
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")
