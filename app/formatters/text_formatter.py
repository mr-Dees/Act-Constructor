"""Форматер для текстового представления актов."""

import html
import re
from typing import Dict

from app.formatters.base_formatter import BaseFormatter


class TextFormatter(BaseFormatter):
    """Форматер для преобразования структуры акта в текстовый формат."""

    def __init__(self):
        """Инициализация текстового форматера."""
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

    def format(self, data: Dict) -> str:
        """
        Форматирует данные акта в текст.

        Args:
            data: Словарь с данными акта

        Returns:
            Отформатированный текст акта
        """
        result = []

        # Сохраняем ссылки на вложенные структуры
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Заголовок
        result.append("=" * 80)
        result.append("АКТ".center(80))
        result.append("=" * 80)
        result.append("")

        # Обработка дерева структуры
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            result.append(self._format_item(item, level=0))

        return "\n".join(result)

    def _format_item(self, item: Dict, level: int = 0) -> str:
        """
        Рекурсивно форматирует пункт акта.

        Args:
            item: Словарь с данными пункта
            level: Уровень вложенности

        Returns:
            Отформатированный пункт
        """
        lines = []
        indent = "  " * level

        # Заголовок пункта
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Пропускаем заголовки для textblock и violation
        if label and item_type not in ['textblock', 'violation']:
            lines.append(f"{indent}{label}")
            lines.append(f"{indent}{'-' * len(label)}")

        # Текстовое содержание
        content = item.get('content', '')
        if content:
            lines.append(f"{indent}{content}")
            lines.append("")

        # Обработка таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            table_data = self.tables[table_id]
            lines.append(self._format_table(table_data, level))
            lines.append("")

        # Обработка текстового блока
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            textblock_data = self.textBlocks[textblock_id]
            lines.append(self._format_textblock(textblock_data, level))
            lines.append("")

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            violation_data = self.violations[violation_id]
            formatted_violation = self._format_violation(violation_data)
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
        Форматирует таблицу с учетом объединенных ячеек и colspan.

        Args:
            table_data: Словарь с данными таблицы
            level: Уровень вложенности (только для text_formatter)

        Returns:
            Отформатированная таблица
        """
        lines = []
        indent = "  " * level  # Только для text_formatter, для markdown используйте ""

        rows = table_data.get('rows', [])

        if not rows:
            return f"{indent}[Пустая таблица]"  # Для markdown: "*[Пустая таблица]*"

        # Строим матрицу отображения с учетом merged и colspan
        display_matrix = []
        max_cols = 0

        for row in rows:
            cells = row.get('cells', [])
            display_row = []

            for cell in cells:
                if not cell.get('merged', False):
                    content = str(cell.get('content', ''))
                    colspan = cell.get('colspan', 1)

                    # Добавляем содержимое в первую ячейку
                    display_row.append(content)

                    # Для остальных колонок в colspan добавляем пустые ячейки
                    for _ in range(colspan - 1):
                        display_row.append('')

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        if not display_matrix or max_cols == 0:
            return f"{indent}[Пустая таблица]"

        # Выравниваем все строки до max_cols
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        # Для text_formatter - ASCII таблица
        # Вычисляем ширину колонок
        col_widths = [0] * max_cols
        for row in display_matrix:
            for col_idx, cell_text in enumerate(row):
                col_widths[col_idx] = max(col_widths[col_idx], len(str(cell_text)))

        def draw_separator():
            parts = ['-' * (width + 2) for width in col_widths]
            return f"{indent}+{'+'.join(parts)}+"

        def draw_row(row):
            row_parts = []
            for col_idx in range(max_cols):
                cell_text = str(row[col_idx]) if col_idx < len(row) else ''
                row_parts.append(f" {cell_text.ljust(col_widths[col_idx])} ")
            return f"{indent}|{'|'.join(row_parts)}|"

        lines.append(draw_separator())

        for idx, row in enumerate(display_matrix):
            lines.append(draw_row(row))
            if idx == 0:
                lines.append(draw_separator())

        lines.append(draw_separator())

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict, level: int = 0) -> str:
        """
        Форматирует текстовый блок с учетом переносов строк и выравнивания.

        Args:
            textblock_data: Словарь с данными текстового блока
            level: Уровень вложенности

        Returns:
            Отформатированный текстовый блок
        """
        indent = "  " * level
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return ""

        # Заменяем <br> на переносы строк ПЕРЕД очисткой HTML
        clean_content = content.replace('<br>', '\n').replace('<br/>', '\n').replace('<br />', '\n')

        # Очищаем HTML-теги
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        # Декодируем HTML-сущности
        clean_content = html.unescape(clean_content)

        # Применяем отступы к каждой строке
        lines = clean_content.split('\n')
        formatted_lines = [f"{indent}{line}" for line in lines]

        # Добавляем метаданные о форматировании
        result = []

        font_size = formatting.get('fontSize', 14)
        alignment = formatting.get('alignment', 'left')

        # Комментарий о настройках форматирования
        if font_size != 14 or alignment != 'left':
            meta = []
            if font_size != 14:
                meta.append(f"размер шрифта: {font_size}px")
            if alignment == 'center':
                meta.append("выравнивание: по центру")
            elif alignment == 'right':
                meta.append("выравнивание: по правому краю")
            elif alignment == 'justify':
                meta.append("выравнивание: по ширине")

            result.append(f"{indent}[{', '.join(meta)}]")

        result.extend(formatted_lines)

        return "\n".join(result)

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение.

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            Отформатированное нарушение
        """
        lines = []

        violated = violation_data.get('violated', '')
        if violated:
            lines.append("Нарушено: " + violated)
            lines.append("")

        established = violation_data.get('established', '')
        if established:
            lines.append("Установлено: " + established)
            lines.append("")

        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                lines.append("Описание:")
                for item in items:
                    if item.strip():
                        lines.append(f"  • {item}")
                lines.append("")

        additional_text = violation_data.get('additionalText', {})
        if additional_text.get('enabled', False):
            content = additional_text.get('content', '')
            if content:
                lines.append(content)
                lines.append("")

        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                lines.append(f"Причины: {content}")
                lines.append("")

        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                lines.append(f"Последствия: {content}")
                lines.append("")

        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                lines.append(f"Ответственные: {content}")
                lines.append("")

        return "\n".join(lines)
