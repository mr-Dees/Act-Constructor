"""
Форматер для Markdown представления актов.

Использует композицию утилит вместо наследования.
"""

from typing import Dict, List

from app.formatters.base_formatter import BaseFormatter
from app.formatters.utils import HTMLUtils, TableUtils, FormattingUtils


class MarkdownFormatter(BaseFormatter):
    """
    Форматер для преобразования структуры акта в Markdown.

    Следует принципу Composition over Inheritance.
    """

    MAX_HEADING_LEVEL = 6

    def format(self, data: Dict) -> str:
        """Форматирует данные акта в Markdown."""
        result = []

        # Извлекаем данные (не сохраняем в self для thread-safety)
        violations = data.get('violations', {})
        textBlocks = data.get('textBlocks', {})
        tables = data.get('tables', {})

        # Главный заголовок
        result.append("# АКТ")
        result.append("")

        # Обработка дерева
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            result.append(
                self._format_item(item, violations, textBlocks, tables, level=2)
            )

        return "\n".join(result)

    def _format_item(
            self,
            item: Dict,
            violations: Dict,
            textBlocks: Dict,
            tables: Dict,
            level: int = 2
    ) -> str:
        """Рекурсивно форматирует пункт акта."""
        lines = []

        label = item.get('label', '')
        item_type = item.get('type', 'item')

        # Заголовок
        if label and item_type not in ['textblock', 'violation', 'table']:
            heading_level = min(level, self.MAX_HEADING_LEVEL)
            heading_prefix = '#' * heading_level
            lines.append(f"{heading_prefix} {label}")
            lines.append("")
        elif label and item_type == 'table':
            lines.append(label)
            lines.append("")

        # Текстовое содержание
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")

        # Таблица
        table_id = item.get('tableId')
        if table_id and table_id in tables:
            lines.append(self._format_table(tables[table_id]))
            lines.append("")

        # Текстовый блок
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in textBlocks:
            lines.append(self._format_textblock(textBlocks[textblock_id]))
            lines.append("")

        # Нарушение
        violation_id = item.get('violationId')
        if violation_id and violation_id in violations:
            lines.append(self._format_violation(violations[violation_id]))
            lines.append("")

        # Рекурсия для детей
        children = item.get('children', [])
        for child in children:
            lines.append(
                self._format_item(child, violations, textBlocks, tables, level + 1)
            )

        return "\n".join(lines)

    def _format_table(self, table_data: Dict) -> str:
        """Форматирует таблицу в Markdown pipe tables."""
        grid = table_data.get('grid', [])

        if not grid:
            return "*[Пустая таблица]*"

        # Используем утилиту через композицию
        display_matrix = TableUtils.build_display_matrix(grid)

        if not display_matrix:
            return "*[Пустая таблица]*"

        lines = []
        max_cols = len(display_matrix[0])

        for idx, row in enumerate(display_matrix):
            # Экранируем pipes через утилиту
            escaped_row = [
                TableUtils.escape_markdown_pipes(cell) for cell in row
            ]
            lines.append('| ' + ' | '.join(escaped_row) + ' |')

            # Разделитель после заголовка
            if idx == 0:
                separator = '|' + '|'.join([' --- ' for _ in range(max_cols)]) + '|'
                lines.append(separator)

        return "\n".join(lines)

    def _format_textblock(self, textblock_data: Dict) -> str:
        """Форматирует текстовый блок с HTML→Markdown конвертацией."""
        content = textblock_data.get('content', '')
        if not content:
            return ""

        formatting = textblock_data.get('formatting', {})

        # Используем HTML утилиту
        clean_content = HTMLUtils.html_to_markdown(content)

        result = []

        # Используем formatting утилиту
        meta = FormattingUtils.build_meta_description(formatting)
        if meta:
            result.append(f"<!-- {', '.join(meta)} -->")
            result.append("")

        result.append(clean_content)
        return "\n".join(result)

    def _format_violation(self, violation_data: Dict) -> str:
        """Форматирует нарушение."""
        lines = []

        self._add_labeled_section(lines, "Нарушено", violation_data.get('violated', ''))
        self._add_labeled_section(lines, "Установлено", violation_data.get('established', ''))
        self._add_description_list(lines, violation_data.get('descriptionList', {}))
        self._add_additional_content(lines, violation_data.get('additionalContent', {}))
        self._add_labeled_section(lines, "Причины", violation_data.get('reasons', {}))
        self._add_labeled_section(lines, "Последствия", violation_data.get('consequences', {}))
        self._add_labeled_section(lines, "Ответственные", violation_data.get('responsible', {}))

        return "\n".join(lines)

    def _add_labeled_section(self, lines: List[str], label: str, data):
        """Добавляет секцию с меткой."""
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
        """Добавляет список описаний."""
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
        """Добавляет дополнительный контент."""
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
        """Добавляет кейс."""
        content = item.get('content', '')
        if content:
            lines.append(f"**Кейс {case_number}:** {content}")
            lines.append("")
            return case_number + 1
        return case_number

    def _add_image(self, lines: List[str], item: Dict):
        """Добавляет ссылку на изображение."""
        caption = item.get('caption', '')
        filename = item.get('filename', '')

        if caption:
            lines.append(f"*{filename}* - {caption}")
        else:
            lines.append(f"*{filename}*")
        lines.append("")

    def _add_free_text(self, lines: List[str], item: Dict):
        """Добавляет свободный текст."""
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")
