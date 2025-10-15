"""Форматер для текстового представления актов."""

import html
import re
from typing import Dict

from app.formatters.base import BaseFormatter


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

        # ИСПРАВЛЕНИЕ: Заголовок пункта отображается для ВСЕХ элементов (удалена проверка protected)
        label = item.get('label', '')
        if label:
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
        Форматирует таблицу с учетом объединенных ячеек.

        Args:
            table_data: Словарь с данными таблицы
            level: Уровень вложенности

        Returns:
            Отформатированная таблица
        """
        lines = []
        indent = "  " * level

        # ИСПРАВЛЕНИЕ: Используем 'rows' вместо 'headers' и 'data'
        rows = table_data.get('rows', [])

        if not rows:
            return f"{indent}[Пустая таблица]"

        # Преобразуем rows в формат для отображения
        display_rows = []
        for row in rows:
            cells = row.get('cells', [])
            display_row = []
            for cell in cells:
                # Пропускаем объединенные ячейки
                if not cell.get('merged', False):
                    display_row.append(cell.get('content', ''))
            if display_row:  # Добавляем только непустые строки
                display_rows.append(display_row)

        if not display_rows:
            return f"{indent}[Пустая таблица]"

        # Вычисляем ширину колонок
        max_cols = max(len(row) for row in display_rows)
        col_widths = [0] * max_cols

        for row in display_rows:
            for col_idx, cell_text in enumerate(row):
                if col_idx < max_cols:
                    col_widths[col_idx] = max(col_widths[col_idx], len(str(cell_text)))

        # Функция для отрисовки разделителя
        def draw_separator():
            parts = ['-' * (width + 2) for width in col_widths]
            return f"{indent}+{'+'.join(parts)}+"

        # Функция для отрисовки строки
        def draw_row(row):
            row_parts = []
            for col_idx in range(max_cols):
                if col_idx < len(row):
                    cell_text = str(row[col_idx])
                else:
                    cell_text = ''
                row_parts.append(f" {cell_text.ljust(col_widths[col_idx])} ")
            return f"{indent}|{'|'.join(row_parts)}|"

        # Отрисовка таблицы
        lines.append(draw_separator())

        for idx, row in enumerate(display_rows):
            lines.append(draw_row(row))
            # Добавляем разделитель после первой строки (заголовок)
            if idx == 0:
                lines.append(draw_separator())

        # Добавляем финальный разделитель
        lines.append(draw_separator())

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
        formatting = textblock_data.get('formatting', {})

        if not content:
            return ""

        # ИСПРАВЛЕНИЕ: Полная очистка HTML-тегов для текстового формата
        clean_content = html.unescape(content)

        # Замена HTML тегов на текстовые эквиваленты
        clean_content = re.sub(r'<br\s*/?>', '\n', clean_content)  # <br> -> перенос строки
        clean_content = re.sub(r'<p[^>]*>', '', clean_content)  # Удаляем открывающие <p>
        clean_content = re.sub(r'</p>', '\n', clean_content)  # </p> -> перенос строки
        clean_content = re.sub(r'<div[^>]*>', '', clean_content)  # Удаляем открывающие <div>
        clean_content = re.sub(r'</div>', '\n', clean_content)  # </div> -> перенос строки
        clean_content = re.sub(r'<[^>]+>', '', clean_content)  # Удаляем все остальные теги

        # Убираем множественные переносы строк
        clean_content = re.sub(r'\n\s*\n+', '\n\n', clean_content)
        clean_content = clean_content.strip()

        lines = clean_content.split('\n')
        alignment = formatting.get('alignment', 'left')

        formatted_lines = []
        for line in lines:
            if not line.strip():
                formatted_lines.append("")
                continue

            if alignment == 'center':
                formatted_lines.append(f"{indent}{line.center(80)}")
            elif alignment == 'right':
                formatted_lines.append(f"{indent}{line.rjust(80)}")
            else:
                formatted_lines.append(f"{indent}{line}")

        return "\n".join(formatted_lines)

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение.

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            Отформатированное нарушение
        """
        lines = []

        lines.append("╔" + "═" * 78 + "╗")
        lines.append("║" + "НАРУШЕНИЕ".center(78) + "║")
        lines.append("╚" + "═" * 78 + "╝")
        lines.append("")

        # Нарушено
        violated = violation_data.get('violated', '')
        if violated:
            lines.append("┌─ Нарушено " + "─" * 66 + "┐")
            lines.append(f"│ {violated.ljust(76)} │")
            lines.append("└" + "─" * 78 + "┘")
            lines.append("")

        # Установлено
        established = violation_data.get('established', '')
        if established:
            lines.append("┌─ Установлено " + "─" * 63 + "┐")
            lines.append(f"│ {established.ljust(76)} │")
            lines.append("└" + "─" * 78 + "┘")
            lines.append("")

        # Список описаний
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                lines.append("Описание:")
                for item in items:
                    if item.strip():
                        lines.append(f"  • {item}")
                lines.append("")

        # Дополнительный текст
        additional_text = violation_data.get('additionalText', {})
        if additional_text.get('enabled', False):
            content = additional_text.get('content', '')
            if content:
                lines.append(content)
                lines.append("")

        # Причины
        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                lines.append(f"Причины: {content}")
                lines.append("")

        # Последствия
        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                lines.append(f"Последствия: {content}")
                lines.append("")

        # Ответственные
        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                lines.append(f"Ответственные: {content}")
                lines.append("")

        return "\n".join(lines)
