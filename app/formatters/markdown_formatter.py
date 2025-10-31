"""
Форматер для Markdown представления актов.

Преобразует структуру акта в формат Markdown с поддержкой
заголовков, таблиц, списков и базового форматирования текста.
"""

import html
import re
from typing import Dict

from app.formatters.base_formatter import BaseFormatter


class MarkdownFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в формат Markdown.

    Создает документ, совместимый с различными Markdown-процессорами,
    с использованием синтаксиса для заголовков, таблиц и форматирования.
    """

    def __init__(self):
        """Инициализация Markdown форматера с пустыми хранилищами."""
        # Хранилища для быстрого доступа к связанным сущностям
        self.violations = {}
        self.textBlocks = {}
        self.tables = {}

    def format(self, data: Dict) -> str:
        """
        Форматирует данные акта в Markdown.

        Args:
            data: Словарь с данными акта:
                - tree: древовидная структура
                - tables: словарь таблиц
                - textBlocks: словарь текстовых блоков
                - violations: словарь нарушений

        Returns:
            str: Отформатированный текст акта в Markdown
        """
        result = []

        # Сохраняем ссылки на вложенные структуры для доступа при рекурсии
        self.violations = data.get('violations', {})
        self.textBlocks = data.get('textBlocks', {})
        self.tables = data.get('tables', {})

        # Главный заголовок (# - уровень 1)
        result.append("# АКТ")
        result.append("")

        # Обработка дерева структуры акта
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        # Рекурсивная обработка каждого пункта верхнего уровня (начиная с ##)
        for item in root_children:
            result.append(self._format_item(item, level=2))

        return "\n".join(result)

    def _format_item(self, item: Dict, level: int = 2) -> str:
        """
        Рекурсивно форматирует пункт акта в Markdown с учетом вложенности.

        Args:
            item: Словарь с данными пункта (узла дерева)
            level: Уровень заголовка (2-6 для ##-######)

        Returns:
            str: Отформатированный пункт со всеми дочерними элементами
        """
        lines = []

        # Извлечение метаданных пункта
        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Заголовок пункта (кроме textblock, violation, table)
        if label and item_type not in ['textblock', 'violation', 'table']:
            heading_level = min(level, 6)  # Markdown поддерживает до 6 уровней
            heading_prefix = '#' * heading_level
            lines.append(f"{heading_prefix} {label}")
            lines.append("")

        # Для таблиц выводим label как обычный текст (не заголовок)
        elif label and item_type == 'table':
            lines.append(label)
            lines.append("")

        # Текстовое содержание пункта
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")

        # Обработка связанной таблицы
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

        # Рекурсивная обработка дочерних элементов (увеличиваем уровень)
        children = item.get('children', [])
        for child in children:
            lines.append(self._format_item(child, level + 1))

        return "\n".join(lines)

    def _format_table(self, table_data: Dict) -> str:
        """
        Форматирует таблицу в Markdown с матричной структурой grid.

        Создает таблицу в синтаксисе Markdown (pipe tables).
        Обрабатывает объединение ячеек (colSpan/rowSpan) путем добавления пустых ячеек.

        Args:
            table_data: Словарь с данными таблицы (grid)

        Returns:
            str: Таблица в формате Markdown
        """
        lines = []

        # Получаем матричную структуру таблицы
        grid = table_data.get('grid', [])

        if not grid or len(grid) == 0:
            return "*[Пустая таблица]*"

        # Построение матрицы отображения (игнорируем spanned ячейки)
        display_matrix = []
        max_cols = 0

        for row_data in grid:
            display_row = []
            for cell_data in row_data:
                # Пропускаем spanned ячейки
                if not cell_data.get('isSpanned', False):
                    # Экранирование pipe символов в содержимом
                    content = str(cell_data.get('content', '')).replace('|', '\\|')
                    colspan = cell_data.get('colSpan', 1)

                    # Первая ячейка получает содержимое
                    display_row.append(content)

                    # Остальные ячейки в colspan - пустые (для имитации объединения)
                    for _ in range(colspan - 1):
                        display_row.append('')

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        if not display_matrix or max_cols == 0:
            return "*[Пустая таблица]*"

        # Выравнивание всех строк до максимальной ширины
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        # Формирование таблицы в Markdown синтаксисе
        for idx, row in enumerate(display_matrix):
            # Строка данных с разделителями pipes
            lines.append('| ' + ' | '.join(row) + ' |')

            # После первой строки (заголовок) добавляем разделитель
            if idx == 0:
                separator = '|' + '|'.join([' --- ' for _ in range(max_cols)]) + '|'
                lines.append(separator)

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict) -> str:
        """
        Форматирует текстовый блок с конвертацией HTML в Markdown.

        Преобразует HTML-теги форматирования в Markdown-синтаксис,
        обрабатывает переносы строк и добавляет метаданные.

        Args:
            textblock_data: Словарь с содержимым и параметрами форматирования

        Returns:
            str: Отформатированный текстовый блок в Markdown
        """
        content = textblock_data.get('content', '')
        formatting = textblock_data.get('formatting', {})

        if not content:
            return ""

        # Замена <br> на hard break Markdown (два пробела + перенос)
        clean_content = content.replace('<br>', '  \n')
        clean_content = clean_content.replace('<br/>', '  \n')
        clean_content = clean_content.replace('<br />', '  \n')

        # Конвертация HTML форматирования в Markdown
        # <b>, <strong> -> **текст**
        clean_content = re.sub(
            r'<(?:b|strong)>(.+?)</(?:b|strong)>',
            r'**\1**',
            clean_content,
            flags=re.DOTALL
        )

        # <i>, <em> -> *текст*
        clean_content = re.sub(
            r'<(?:i|em)>(.+?)</(?:i|em)>',
            r'*\1*',
            clean_content,
            flags=re.DOTALL
        )

        # <u> -> текст (Markdown не поддерживает underline нативно)
        clean_content = re.sub(
            r'<u>(.+?)</u>',
            r'\1',
            clean_content,
            flags=re.DOTALL
        )

        # Удаление остальных HTML-тегов
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        # Декодирование HTML-сущностей (&nbsp;, &lt;, и т.д.)
        clean_content = html.unescape(clean_content)

        # Добавление метаданных о форматировании (если отличается от default)
        result = []
        font_size = formatting.get('fontSize', 14)
        alignment = formatting.get('alignment', 'left')

        if font_size != 14 or alignment != 'left':
            meta = []
            if font_size != 14:
                meta.append(f"размер шрифта {font_size}px")
            if alignment == 'center':
                meta.append("выравнивание по центру")
            elif alignment == 'right':
                meta.append("выравнивание справа")
            elif alignment == 'justify':
                meta.append("выравнивание по ширине")

            # Комментарий HTML в Markdown для сохранения информации о форматировании
            result.append(f"<!-- {', '.join(meta)} -->")
            result.append("")

        result.append(clean_content)
        return "\n".join(result)

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение в Markdown с жирными заголовками секций.

        Структура:
        - **Нарушено:** <текст>
        - **Установлено:** <текст>
        - **Описание:** <буллитный список>
        - Дополнительный текст
        - **Причины:** <текст>
        - **Последствия:** <текст>
        - **Ответственные:** <текст>

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            str: Отформатированное нарушение в Markdown
        """
        lines = []

        # Секция "Нарушено" с жирным выделением
        violated = violation_data.get('violated', '')
        if violated:
            lines.append(f"**Нарушено:** {violated}")
            lines.append("")

        # Секция "Установлено" с жирным выделением
        established = violation_data.get('established', '')
        if established:
            lines.append(f"**Установлено:** {established}")
            lines.append("")

        # Список описаний (Markdown unordered list)
        desc_list = violation_data.get('descriptionList', {})
        if desc_list.get('enabled', False):
            items = desc_list.get('items', [])
            if items:
                lines.append("**Описание:**")
                for item in items:
                    if item.strip():
                        # Markdown буллитный список (dash)
                        lines.append(f"- {item}")
                lines.append("")

        # Дополнительный контент
        additional_content = violation_data.get('additionalContent', {})
        if additional_content.get('enabled', False):
            items = additional_content.get('items', [])

            # Вычисляем номера кейсов
            case_number = 1

            for item in items:
                item_type = item.get('type')

                if item_type == 'case':
                    content = item.get('content', '')
                    if content:
                        lines.append(f"**Кейс {case_number}:** {content}")
                        lines.append("")
                        case_number += 1

                elif item_type == 'image':
                    case_number = 1
                    caption = item.get('caption', '')
                    filename = item.get('filename', '')
                    if caption:
                        lines.append(f"*{filename}* - {caption}")
                    else:
                        lines.append(f"*{filename}*")
                    lines.append("")

                elif item_type == 'freeText':
                    case_number = 1
                    content = item.get('content', '')
                    if content:
                        lines.append(content)
                        lines.append("")

        # Причины нарушения
        reasons = violation_data.get('reasons', {})
        if reasons.get('enabled', False):
            content = reasons.get('content', '')
            if content:
                lines.append(f"**Причины:** {content}")
                lines.append("")

        # Последствия нарушения
        consequences = violation_data.get('consequences', {})
        if consequences.get('enabled', False):
            content = consequences.get('content', '')
            if content:
                lines.append(f"**Последствия:** {content}")
                lines.append("")

        # Ответственные лица
        responsible = violation_data.get('responsible', {})
        if responsible.get('enabled', False):
            content = responsible.get('content', '')
            if content:
                lines.append(f"**Ответственные:** {content}")
                lines.append("")

        return "\n".join(lines)
