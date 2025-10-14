"""Форматер для текстового представления актов."""

import html
from typing import Dict

from app.formatters.base import BaseFormatter


class TextFormatter(BaseFormatter):
    """Форматер для преобразования структуры акта в текстовый формат."""

    def format(self, data: Dict) -> str:
        """
        Форматирует данные акта в текст.

        Args:
            data: Словарь с данными акта

        Returns:
            Отформатированный текст акта
        """
        result = []

        # Обработка таблиц перед пунктом 1
        if data.get('tablesBefore'):
            for table_data in data['tablesBefore']:
                result.append("=== Таблица перед пунктом 1 ===")
                result.append(self._format_table(table_data))
                result.append("")

        # Обработка пунктов
        if data.get('items'):
            for item in data['items']:
                result.append(self._format_item(item))

        return "\n\n".join(result)

    def _format_item(self, item: Dict, level: int = 0) -> str:
        """
        Форматирует пункт акта.

        Args:
            item: Словарь с данными пункта
            level: Уровень вложенности

        Returns:
            Отформатированный пункт
        """
        lines = []
        indent = "  " * level

        # Заголовок пункта
        title = item.get('title', '')
        if title:
            lines.append(f"{indent}{title}")

        # Содержание пункта
        content = item.get('content', '')
        if content:
            lines.append(f"{indent}{content}")

        # Таблицы в пункте
        if item.get('tables'):
            for table_data in item['tables']:
                lines.append(f"{indent}=== Таблица ===")
                lines.append(self._format_table(table_data, level))

        # Текстовые блоки в пункте
        if item.get('textBlocks'):
            for textblock_data in item['textBlocks']:
                lines.append(f"{indent}=== Текстовый блок ===")
                lines.append(self._format_textblock(textblock_data, level))

        # Подпункты
        if item.get('children'):
            for child in item['children']:
                lines.append(self._format_item(child, level + 1))

        return "\n".join(lines)

    def _format_table(self, table_data: Dict, level: int = 0) -> str:
        """
        Форматирует таблицу с учетом объединенных ячеек.

        Args:
            table_data: Словарь с данными таблицы
            level: Уровень вложенности

        Returns:
            Отформатированная таблица
        """
        lines = []
        indent = "  " * level

        rows = table_data.get('rows', [])
        if not rows:
            return f"{indent}[Пустая таблица]"

        # Вычислить максимальную ширину для каждой колонки
        max_cols = max(len(row) for row in rows) if rows else 0
        col_widths = [0] * max_cols

        for row in rows:
            for col_idx, cell in enumerate(row):
                if col_idx < max_cols:
                    content = str(cell.get('content', ''))
                    col_widths[col_idx] = max(col_widths[col_idx], len(content))

        # Рендер таблицы
        for row_idx, row in enumerate(rows):
            row_parts = []
            for col_idx, cell in enumerate(row):
                if col_idx < max_cols:
                    content = str(cell.get('content', '')).ljust(col_widths[col_idx])
                    row_parts.append(content)

            lines.append(f"{indent}| {' | '.join(row_parts)} |")

            # Разделитель после заголовка
            if row_idx == 0:
                separator_parts = ['-' * width for width in col_widths]
                lines.append(f"{indent}|-{'-|-'.join(separator_parts)}-|")

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict, level: int = 0) -> str:
        """
        Форматирует текстовый блок.

        Args:
            textblock_data: Словарь с данными текстового блока
            level: Уровень вложенности

        Returns:
            Отформатированный текстовый блок
        """
        indent = "  " * level
        content = textblock_data.get('content', '')

        # Удаляем HTML теги для текстового представления
        clean_content = html.unescape(content)
        clean_content = clean_content.replace('<br>', '\n')
        clean_content = ''.join(char for char in clean_content if char.isprintable() or char in '\n\t ')

        formatting = textblock_data.get('formatting', {})
        alignment = formatting.get('alignment', 'left')

        lines = clean_content.split('\n')
        formatted_lines = []

        for line in lines:
            if alignment == 'center':
                formatted_lines.append(f"{indent}{line.center(80)}")
            elif alignment == 'right':
                formatted_lines.append(f"{indent}{line.rjust(80)}")
            else:
                formatted_lines.append(f"{indent}{line}")

        return "\n".join(formatted_lines)
