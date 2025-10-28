"""
Форматер для текстового представления актов.

Преобразует структуру акта в простой текстовый формат (plain text)
с ASCII-таблицами и отступами для иерархии.
"""

import html
import re
from typing import Dict

from app.formatters.base_formatter import BaseFormatter


class TextFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в текстовый формат.

    Создает читаемое текстовое представление с использованием
    ASCII-графики для таблиц и отступов для передачи структуры.
    """

    def __init__(self):
        """Инициализация текстового форматера с пустыми хранилищами."""
        # Хранилища для быстрого доступа к связанным сущностям
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

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
        result.append("=" * 80)
        result.append("АКТ".center(80))
        result.append("=" * 80)
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
        # Отступ зависит от уровня вложенности (каждый уровень = 2 пробела)
        indent = "  " * level

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
        Форматирует таблицу в ASCII-графику с учетом объединения ячеек.

        Создает псевдографическую таблицу с рамками и разделителями.
        Обрабатывает colspan (объединение колонок).

        Args:
            table_data: Словарь с данными таблицы (rows с cells)
            level: Уровень вложенности для отступов

        Returns:
            str: ASCII-таблица с рамками
        """
        lines = []
        indent = "  " * level

        rows = table_data.get('rows', [])
        if not rows:
            return f"{indent}[Пустая таблица]"

        # Построение матрицы отображения с учетом merged и colspan
        display_matrix = []
        max_cols = 0

        for row in rows:
            cells = row.get('cells', [])
            display_row = []

            for cell in cells:
                # Пропускаем объединенные ячейки (уже обработаны)
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

        # Выравнивание всех строк до максимальной ширины
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        # Вычисление ширины колонок на основе содержимого
        col_widths = [0] * max_cols
        for row in display_matrix:
            for col_idx, cell_text in enumerate(row):
                col_widths[col_idx] = max(
                    col_widths[col_idx],
                    len(str(cell_text))
                )

        def draw_separator():
            """Создает горизонтальный разделитель таблицы."""
            parts = ['-' * (width + 2) for width in col_widths]
            return f"{indent}+{'+'.join(parts)}+"

        def draw_row(row):
            """Создает строку таблицы с содержимым ячеек."""
            row_parts = []
            for col_idx in range(max_cols):
                cell_text = str(row[col_idx]) if col_idx < len(row) else ''
                # Выравнивание по левому краю с padding
                row_parts.append(f" {cell_text.ljust(col_widths[col_idx])} ")
            return f"{indent}|{'|'.join(row_parts)}|"

        # Построение ASCII-таблицы
        lines.append(draw_separator())  # Верхняя граница

        for idx, row in enumerate(display_matrix):
            lines.append(draw_row(row))
            # Разделитель после заголовка (первой строки)
            if idx == 0:
                lines.append(draw_separator())

        lines.append(draw_separator())  # Нижняя граница

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict, level: int = 0) -> str:
        """
        Форматирует текстовый блок с очисткой HTML и применением отступов.

        Обрабатывает переносы строк, удаляет HTML-теги,
        декодирует HTML-сущности и добавляет метаданные о форматировании.

        Args:
            textblock_data: Словарь с содержимым и параметрами форматирования
            level: Уровень вложенности для отступов

        Returns:
            str: Отформатированный текстовый блок
        """
        indent = "  " * level
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return ""

        # Замена <br> на переносы строк ПЕРЕД очисткой HTML
        clean_content = content.replace('<br>', '\n')
        clean_content = clean_content.replace('<br/>', '\n')
        clean_content = clean_content.replace('<br />', '\n')

        # Удаление всех HTML-тегов
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        # Декодирование HTML-сущностей (&nbsp;, &lt;, и т.д.)
        clean_content = html.unescape(clean_content)

        # Применение отступов к каждой строке
        lines = clean_content.split('\n')
        formatted_lines = [f"{indent}{line}" for line in lines]

        # Добавление метаданных о форматировании (если отличается от default)
        result = []
        font_size = formatting.get('fontSize', 14)
        alignment = formatting.get('alignment', 'left')

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

            # Комментарий о форматировании в квадратных скобках
            result.append(f"{indent}[{', '.join(meta)}]")

        result.extend(formatted_lines)
        return "\n".join(result)

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение с всеми секциями.

        Структура:
        - Нарушено: <текст>
        - Установлено: <текст>
        - Описание: <буллитный список>
        - Дополнительный текст
        - Причины: <текст>
        - Последствия: <текст>
        - Ответственные: <текст>

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            str: Отформатированное нарушение
        """
        lines = []

        # Секция "Нарушено"
        violated = violation_data.get('violated', '')
        if violated:
            lines.append("Нарушено: " + violated)
            lines.append("")

        # Секция "Установлено"
        established = violation_data.get('established', '')
        if established:
            lines.append("Установлено: " + established)
            lines.append("")

        # Список описаний (буллитный)
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                lines.append("Описание:")
                for item in items:
                    if item.strip():
                        # Unicode маркер для буллитного списка
                        lines.append(f"  • {item}")
                lines.append("")

        # Дополнительный контент
        additional_content = violation_data.get('additionalContent', {})
        if additional_content.get('enabled', False):
            items = additional_content.get('items', [])

            for item in items:
                item_type = item.get('type')

                if item_type == 'case':
                    content = item.get('content', '')
                    if content:
                        lines.append(f"Кейс: {content}")
                        lines.append("")

                elif item_type == 'image':
                    caption = item.get('caption', '')
                    filename = item.get('filename', '')
                    if caption:
                        lines.append(f"Изображение: {filename} - {caption}")
                    else:
                        lines.append(f"Изображение: {filename}")
                    lines.append("")

                elif item_type == 'freeText':
                    content = item.get('content', '')
                    if content:
                        lines.append(content)
                        lines.append("")

        # Причины нарушения
        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                lines.append(f"Причины: {content}")
                lines.append("")

        # Последствия нарушения
        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                lines.append(f"Последствия: {content}")
                lines.append("")

        # Ответственные лица
        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                lines.append(f"Ответственные: {content}")
                lines.append("")

        return "\n".join(lines)
