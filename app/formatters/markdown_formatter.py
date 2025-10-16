"""Форматер для Markdown представления актов."""

import html
import re
from typing import Dict

from app.formatters.base_formatter import BaseFormatter


class MarkdownFormatter(BaseFormatter):
    """Форматер для преобразования структуры акта в формат Markdown."""

    def __init__(self):
        """Инициализация Markdown форматера."""
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

    def format(self, data: Dict) -> str:
        """
        Форматирует данные акта в Markdown.

        Args:
            data: Словарь с данными акта

        Returns:
            Отформатированный текст акта в Markdown
        """
        result = []

        # Сохраняем ссылки на вложенные структуры
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Заголовок
        result.append("# АКТ")
        result.append("")

        # Обработка дерева структуры
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            result.append(self._format_item(item, level=2))

        return "\n".join(result)

    def _format_item(self, item: Dict, level: int = 2) -> str:
        """
        Рекурсивно форматирует пункт акта в Markdown.

        Args:
            item: Словарь с данными пункта
            level: Уровень заголовка (2-6 для ##-######)

        Returns:
            Отформатированный пункт
        """
        lines = []

        # Заголовок пункта
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Пропускаем заголовки для textblock, violation и table
        if label and item_type not in ['textblock', 'violation', 'table']:
            heading_level = min(level, 6)
            heading_prefix = '#' * heading_level
            lines.append(f"{heading_prefix} {label}")
            lines.append("")

        # Для таблиц выводим label как обычный текст
        elif label and item_type == 'table':
            lines.append(label)
            lines.append("")

        # Текстовое содержание
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")

        # Обработка таблицы
        table_id = item.get('tableId')
        if table_id and table_id in self.tables:
            table_data = self.tables[table_id]
            lines.append(self._format_table(table_data))
            lines.append("")

        # Обработка текстового блока
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            textblock_data = self.textBlocks[textblock_id]
            lines.append(self._format_textblock(textblock_data))
            lines.append("")

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            violation_data = self.violations[violation_id]
            lines.append(self._format_violation(violation_data))
            lines.append("")

        # Рекурсивная обработка дочерних элементов
        children = item.get('children', [])
        for child in children:
            lines.append(self._format_item(child, level + 1))

        return "\n".join(lines)

    def _format_table(self, table_data: Dict) -> str:
        """
        Форматирует таблицу в Markdown с учетом объединенных ячеек.

        Args:
            table_data: Словарь с данными таблицы

        Returns:
            Отформатированная таблица в Markdown
        """
        lines = []

        rows = table_data.get('rows', [])

        if not rows:
            return "*[Пустая таблица]*"

        # Строим матрицу с учетом merged и colspan
        display_matrix = []
        max_cols = 0

        for row in rows:
            cells = row.get('cells', [])
            display_row = []

            for cell in cells:
                if not cell.get('merged', False):
                    content = str(cell.get('content', '')).replace('|', '\\|')
                    colspan = cell.get('colspan', 1)

                    # Первая ячейка получает содержимое
                    display_row.append(content)

                    # Остальные ячейки в colspan - пустые
                    for _ in range(colspan - 1):
                        display_row.append('')

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        if not display_matrix or max_cols == 0:
            return "*[Пустая таблица]*"

        # Выравниваем строки
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        # Формируем Markdown таблицу
        for idx, row in enumerate(display_matrix):
            lines.append('| ' + ' | '.join(row) + ' |')
            if idx == 0:
                separator = '|' + '|'.join([' --- ' for _ in range(max_cols)]) + '|'
                lines.append(separator)

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict) -> str:
        """
        Форматирует текстовый блок в Markdown с учетом форматирования.

        Args:
            textblock_data: Словарь с данными текстового блока

        Returns:
            Отформатированный текстовый блок
        """
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return ""

        clean_content = html.unescape(content)

        # Преобразуем HTML форматирование в Markdown
        clean_content = re.sub(r'<(?:b|strong)>(.+?)</(?:b|strong)>', r'**\1**', clean_content, flags=re.DOTALL)
        clean_content = re.sub(r'<(?:i|em)>(.+?)</(?:i|em)>', r'*\1*', clean_content, flags=re.DOTALL)
        clean_content = re.sub(r'<u>(.+?)</u>', r'_\1_', clean_content, flags=re.DOTALL)

        # Сохраняем переносы строк
        clean_content = re.sub(r'<br\s*/?>', '\n', clean_content)
        clean_content = re.sub(r'</p>', '\n\n', clean_content)
        clean_content = re.sub(r'</div>', '\n\n', clean_content)

        # Удаляем открывающие теги
        clean_content = re.sub(r'<p[^>]*>', '', clean_content)
        clean_content = re.sub(r'<div[^>]*>', '', clean_content)

        # Удаляем все остальные теги
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        clean_content = re.sub(r'\n\n+', '\n\n', clean_content)
        clean_content = clean_content.strip()

        # Применяем выравнивание
        alignment = formatting.get('alignment', 'left')
        if alignment == 'center':
            clean_content = f'<div align="center">\n\n{clean_content}\n\n</div>'
        elif alignment == 'right':
            clean_content = f'<div align="right">\n\n{clean_content}\n\n</div>'

        return clean_content

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение в Markdown.

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            Отформатированное нарушение
        """
        lines = []

        violated = violation_data.get('violated', '')
        if violated:
            lines.append(f"**Нарушено:** {violated}")
            lines.append("")

        established = violation_data.get('established', '')
        if established:
            lines.append(f"**Установлено:** {established}")
            lines.append("")

        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                lines.append("**Описание:**")
                for item in items:
                    if item.strip():
                        lines.append(f"- {item}")
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
                lines.append(f"**Причины:** {content}")
                lines.append("")

        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                lines.append(f"**Последствия:** {content}")
                lines.append("")

        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                lines.append(f"**Ответственные:** {content}")
                lines.append("")

        return "\n".join(lines)
