"""
Форматер для текстового представления актов.

Создает plain text с ASCII-таблицами и отступами для иерархии.
"""

from app.core.config import Settings
from app.formatters.base_formatter import BaseFormatter
from app.formatters.utils import HTMLUtils, TableUtils, FormattingUtils


class TextFormatter(BaseFormatter):
    """
    Форматер для plain text с ASCII-графикой.

    Использует композицию утилит для обработки данных и создания
    визуально приятного текстового представления с таблицами.
    """

    def __init__(self, settings: Settings):
        """
        Инициализация форматера с настройками.

        Args:
            settings: Глобальные настройки приложения
        """
        self.settings = settings
        self.HEADER_WIDTH = settings.text_header_width
        self.INDENT_SIZE = settings.text_indent_size

    def format(self, data: dict) -> str:
        """
        Форматирует данные акта в plain text.

        Args:
            data: Данные акта (tree, tables, textBlocks, violations)

        Returns:
            Plain text представление акта
        """
        result = []

        # Извлекаем данные
        violations = data.get('violations', {})
        textBlocks = data.get('textBlocks', {})
        tables = data.get('tables', {})

        # Декоративный заголовок
        result.append("=" * self.HEADER_WIDTH)
        result.append("АКТ".center(self.HEADER_WIDTH))
        result.append("=" * self.HEADER_WIDTH)
        result.append("")

        # Обработка дерева
        tree = data.get('tree', {})
        root_children = tree.get('children', [])

        for item in root_children:
            result.append(
                self._format_item(item, violations, textBlocks, tables, level=0)
            )

        return "\n".join(result)

    def _format_item(
            self,
            item: dict,
            violations: dict,
            textBlocks: dict,
            tables: dict,
            level: int = 0
    ) -> str:
        """
        Рекурсивно форматирует пункт с отступами.

        Args:
            item: Узел дерева акта
            violations: Словарь нарушений
            textBlocks: Словарь текстовых блоков
            tables: Словарь таблиц
            level: Уровень вложенности (для отступов)

        Returns:
            Текстовое представление пункта
        """
        lines = []
        indent = " " * (self.INDENT_SIZE * level)

        label = item.get('label', '')
        number = item.get('number', '')
        item_type = item.get('type', 'item')

        # Для item-узлов собираем полный заголовок из номера и текста
        if item_type not in ['table', 'textblock', 'violation']:
            full_label = f"{number}. {label}" if number and label else (label or number)
        else:
            full_label = item.get('customLabel') or number or label

        # Заголовок с подчеркиванием
        if full_label and item_type not in ['textblock', 'violation']:
            lines.append(f"{indent}{full_label}")
            lines.append(f"{indent}{'-' * len(full_label)}")

        # Текстовое содержание
        content = item.get('content', '')
        if content:
            lines.append(f"{indent}{content}")
            lines.append("")

        # Таблица
        table_id = item.get('tableId')
        if table_id and table_id in tables:
            lines.append(self._format_table(tables[table_id], level))
            lines.append("")

        # Текстовый блок
        textblock_id = item.get('textBlockId')
        if textblock_id and textblock_id in textBlocks:
            lines.append(self._format_textblock(textBlocks[textblock_id], level))
            lines.append("")

        # Нарушение
        violation_id = item.get('violationId')
        if violation_id and violation_id in violations:
            formatted_violation = self._format_violation(violations[violation_id])
            # Применяем отступ к каждой строке
            for line in formatted_violation.split('\n'):
                lines.append(f"{indent}{line}")
            lines.append("")

        # Рекурсия для дочерних элементов
        children = item.get('children', [])
        for child in children:
            lines.append(
                self._format_item(child, violations, textBlocks, tables, level + 1)
            )

        return "\n".join(lines)

    def _format_table(self, table_data: dict, level: int = 0) -> str:
        """
        Форматирует таблицу в ASCII-графику.

        Args:
            table_data: Данные таблицы с grid структурой
            level: Уровень вложенности (для отступов)

        Returns:
            ASCII-таблица
        """
        indent = " " * (self.INDENT_SIZE * level)
        grid = table_data.get('grid', [])

        if not grid:
            return f"{indent}[Пустая таблица]"

        # Используем утилиту для построения матрицы
        display_matrix = TableUtils.build_display_matrix(grid)

        if not display_matrix:
            return f"{indent}[Пустая таблица]"

        # Используем утилиту для вычисления ширины колонок
        col_widths = TableUtils.calculate_column_widths(display_matrix)

        # Построение ASCII-таблицы
        lines = []
        separator = self._draw_separator(col_widths, indent)

        lines.append(separator)  # Верхняя граница

        for idx, row in enumerate(display_matrix):
            lines.append(self._draw_row(row, col_widths, indent))
            # Разделитель после заголовка
            if idx == 0:
                lines.append(separator)

        lines.append(separator)  # Нижняя граница

        return "\n".join(lines)

    def _draw_separator(self, col_widths: list[int], indent: str) -> str:
        """
        Создает горизонтальный разделитель таблицы.

        Args:
            col_widths: Ширины колонок
            indent: Отступ для текущего уровня

        Returns:
            Строка разделителя
        """
        parts = ['-' * (width + 2) for width in col_widths]
        return f"{indent}+{'+'.join(parts)}+"

    def _draw_row(self, row: list[str], col_widths: list[int], indent: str) -> str:
        """
        Создает строку таблицы с содержимым.

        Args:
            row: Данные строки
            col_widths: Ширины колонок
            indent: Отступ для текущего уровня

        Returns:
            Отформатированная строка таблицы
        """
        row_parts = []
        for col_idx, width in enumerate(col_widths):
            cell_text = str(row[col_idx]) if col_idx < len(row) else ''
            row_parts.append(f" {cell_text.ljust(width)} ")
        return f"{indent}|{'|'.join(row_parts)}|"

    def _format_textblock(self, textblock_data: dict, level: int = 0) -> str:
        """
        Форматирует текстовый блок с очисткой HTML.

        Args:
            textblock_data: Данные блока с HTML контентом
            level: Уровень вложенности (для отступов)

        Returns:
            Очищенный текст с отступами
        """
        indent = " " * (self.INDENT_SIZE * level)
        content = textblock_data.get('content', '')

        if not content:
            return ""

        formatting = textblock_data.get('formatting', {})

        # Используем HTML утилиту для очистки
        clean_content = HTMLUtils.clean_html(content)

        # Применение отступов к каждой строке
        lines = clean_content.split('\n')
        formatted_lines = [f"{indent}{line}" for line in lines]

        result = []

        # Используем formatting утилиту для метаданных
        meta = FormattingUtils.build_meta_description(formatting)
        if meta:
            result.append(f"{indent}[{', '.join(meta)}]")

        result.extend(formatted_lines)
        return "\n".join(result)

    def _format_violation(self, violation_data: dict) -> str:
        """
        Форматирует нарушение.

        Args:
            violation_data: Данные нарушения

        Returns:
            Текстовое представление нарушения
        """
        lines = []

        self._add_labeled_section(lines, "Нарушено", violation_data.get('violated', ''))
        self._add_labeled_section(lines, "Установлено", violation_data.get('established', ''))
        self._add_description_list(lines, violation_data.get('descriptionList', {}))
        self._add_additional_content(lines, violation_data.get('additionalContent', {}))
        self._add_labeled_section(lines, "Причины", violation_data.get('reasons', {}))
        self._add_labeled_section(lines, "Последствия", violation_data.get('consequences', {}))
        self._add_labeled_section(lines, "Ответственные", violation_data.get('responsible', {}))

        return "\n".join(lines)

    def _add_labeled_section(self, lines: list[str], label: str, data):
        """
        Добавляет секцию с меткой.

        Args:
            lines: Список строк для добавления
            label: Текст метки
            data: Данные секции (dict с enabled/content или строка)
        """
        if isinstance(data, dict):
            if not data.get('enabled', False):
                return
            content = data.get('content', '')
        else:
            content = data

        if content:
            lines.append(f"{label}: {content}")
            lines.append("")

    def _add_description_list(self, lines: list[str], desc_list: dict):
        """
        Добавляет список описаний.

        Args:
            lines: Список строк для добавления
            desc_list: Данные списка с items
        """
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

    def _add_additional_content(self, lines: list[str], additional_content: dict):
        """
        Добавляет дополнительный контент (кейсы, изображения, свободный текст).

        Args:
            lines: Список строк для добавления
            additional_content: Данные с items разных типов
        """
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

    def _add_case(self, lines: list[str], item: dict, case_number: int) -> int:
        """
        Добавляет кейс с нумерацией.

        Args:
            lines: Список строк для добавления
            item: Данные кейса
            case_number: Текущий номер кейса

        Returns:
            Следующий номер кейса
        """
        content = item.get('content', '')
        if content:
            lines.append(f"Кейс {case_number}: {content}")
            lines.append("")
            return case_number + 1
        return case_number

    def _add_image(self, lines: list[str], item: dict):
        """
        Добавляет ссылку на изображение.

        Args:
            lines: Список строк для добавления
            item: Данные изображения
        """
        caption = item.get('caption', '')
        filename = item.get('filename', '')

        if caption:
            lines.append(f"Изображение: {filename} - {caption}")
        else:
            lines.append(f"Изображение: {filename}")
        lines.append("")

    def _add_free_text(self, lines: list[str], item: dict):
        """
        Добавляет свободный текст.

        Args:
            lines: Список строк для добавления
            item: Данные с текстом
        """
        content = item.get('content', '')
        if content:
            lines.append(content)
            lines.append("")
