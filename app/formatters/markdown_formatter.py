"""
Форматер для Markdown представления актов.

Преобразует структуру акта в формат Markdown с поддержкой
заголовков, таблиц, списков и базового форматирования текста.
"""

import html
import re
from typing import Dict, List

from app.formatters.base_formatter import BaseFormatter


class MarkdownFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в формат Markdown.

    Создает документ, совместимый с различными Markdown-процессорами,
    с использованием синтаксиса для заголовков, таблиц и форматирования.
    """

    # Константы для настройки форматирования
    MAX_HEADING_LEVEL = 6
    DEFAULT_FONT_SIZE = 14
    DEFAULT_ALIGNMENT = 'left'

    def __init__(self):
        """Инициализация Markdown форматера с пустыми хранилищами."""
        # Хранилища для быстрого доступа к связанным сущностям
        self.violations: Dict = {}
        self.textBlocks: Dict = {}
        self.tables: Dict = {}

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
            heading_level = min(level, self.MAX_HEADING_LEVEL)
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
            lines.append(self._format_table(self.tables[table_id]))
            lines.append("")

        # Обработка текстового блока
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in self.textBlocks:
            lines.append(self._format_textblock(self.textBlocks[textblock_id]))
            lines.append("")

        # Обработка нарушения
        violation_id = item.get('violationId')
        if violation_id and violation_id in self.violations:
            lines.append(self._format_violation(self.violations[violation_id]))
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
        grid = table_data.get('grid', [])

        if not grid:
            return "*[Пустая таблица]*"

        # Построение матрицы отображения
        display_matrix = self._build_display_matrix(grid)

        if not display_matrix:
            return "*[Пустая таблица]*"

        # Формирование таблицы в Markdown синтаксисе
        lines = []
        max_cols = len(display_matrix[0])

        for idx, row in enumerate(display_matrix):
            # Строка данных с разделителями pipes
            lines.append('| ' + ' | '.join(row) + ' |')

            # После первой строки (заголовок) добавляем разделитель
            if idx == 0:
                separator = '|' + '|'.join([' --- ' for _ in range(max_cols)]) + '|'
                lines.append(separator)

        return "\n".join(lines)

    def _build_display_matrix(self, grid: List[List[Dict]]) -> List[List[str]]:
        """
        Строит матрицу отображения из grid-структуры с обработкой colspan.

        Args:
            grid: Двумерный массив ячеек

        Returns:
            List[List[str]]: Матрица строк для отображения
        """
        display_matrix = []
        max_cols = 0

        for row_data in grid:
            display_row = []
            for cell_data in row_data:
                # Пропускаем spanned ячейки
                if cell_data.get('isSpanned', False):
                    continue

                # Экранирование pipe символов в содержимом
                content = str(cell_data.get('content', '')).replace('|', '\\|')
                colspan = cell_data.get('colSpan', 1)

                # Первая ячейка получает содержимое
                display_row.append(content)

                # Остальные ячейки в colspan - пустые
                for _ in range(colspan - 1):
                    display_row.append('')

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        # Выравнивание всех строк до максимальной ширины
        for row in display_matrix:
            while len(row) < max_cols:
                row.append('')

        return display_matrix

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
        if not content:
            return ""

        formatting = textblock_data.get('formatting', {})

        # Конвертация HTML в Markdown
        clean_content = self._html_to_markdown(content)

        # Добавление метаданных о форматировании
        result = []
        meta = self._build_formatting_meta(formatting)
        if meta:
            result.append(f"<!-- {', '.join(meta)} -->")
            result.append("")

        result.append(clean_content)
        return "\n".join(result)

    def _html_to_markdown(self, content: str) -> str:
        """Преобразует HTML в Markdown синтаксис"""
        # Замена <br> на hard break Markdown
        clean_content = re.sub(
            r'<br\s*/?>',
            '  \n',
            content,
            flags=re.IGNORECASE
        )

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

        # <u> -> текст (Markdown не поддерживает underline)
        clean_content = re.sub(
            r'<u>(.+?)</u>',
            r'\1',
            clean_content,
            flags=re.DOTALL
        )

        # Удаление остальных HTML-тегов
        clean_content = re.sub(r'<[^>]+>', '', clean_content)

        # Декодирование HTML-сущностей
        return html.unescape(clean_content)

    def _build_formatting_meta(self, formatting: Dict) -> List[str]:
        """Создает список метаданных о форматировании"""
        meta = []
        font_size = formatting.get('fontSize', self.DEFAULT_FONT_SIZE)
        alignment = formatting.get('alignment', self.DEFAULT_ALIGNMENT)

        if font_size != self.DEFAULT_FONT_SIZE:
            meta.append(f"размер шрифта {font_size}px")

        if alignment == 'center':
            meta.append("выравнивание по центру")
        elif alignment == 'right':
            meta.append("выравнивание справа")
        elif alignment == 'justify':
            meta.append("выравнивание по ширине")

        return meta

    def _format_violation(self, violation_data: Dict) -> str:
        """
        Форматирует нарушение в Markdown с жирными заголовками секций.

        Args:
            violation_data: Словарь с данными нарушения

        Returns:
            str: Отформатированное нарушение в Markdown
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
        # Обработка опциональных полей
        if isinstance(data, dict):
            if not data.get('enabled', False):
                return
            content = data.get('content', '')
        else:
            content = data

        if content:
            lines.append(f"**{label}:** {content}")
            lines.append("")

    def _add_description_list(self, lines: List[str], desc_list: Dict):
        """Добавляет список описаний"""
        if not desc_list.get('enabled', False):
            return

        items = desc_list.get('items', [])
        if not items:
            return

        lines.append("**Описание:**")
        for item in items:
            if item.strip():
                lines.append(f"- {item}")
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
            lines.append(f"**Кейс {case_number}:** {content}")
            lines.append("")
            return case_number + 1
        return case_number

    def _add_image(self, lines: List[str], item: Dict):
        """Добавляет ссылку на изображение"""
        caption = item.get('caption', '')
        filename = item.get('filename', '')

        if caption:
            lines.append(f"*{filename}* - {caption}")
        else:
            lines.append(f"*{filename}*")
        lines.append("")

    def _add_free_text(self, lines: List[str], item: Dict):
        """Добавляет свободный текст"""
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")
