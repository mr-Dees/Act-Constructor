"""Форматер для текстового представления актов."""

from typing import Dict, List
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

    def _format_table(self, table_data: Dict) -> str:
        """
        Форматирует таблицу с учетом объединенных ячеек.

        Args:
            table_data: Словарь с данными таблицы

        Returns:
            Отформатированная таблица
        """
        lines = []
        lines.append(f"Таблица {table_data.get('rows', 0)}x{table_data.get('cols', 0)}:")

        # Заголовки
        headers = table_data.get('headers', [])
        if headers:
            lines.append("  " + " | ".join(str(h) for h in headers))
            lines.append("  " + "-" * (len(" | ".join(str(h) for h in headers))))

        # Данные с учетом объединенных ячеек
        merged = table_data.get('mergedCells', {})
        for i, row in enumerate(table_data.get('data', [])):
            row_text = []
            for j, cell in enumerate(row):
                if not self._is_cell_hidden(merged, i, j):
                    merge_info = merged.get(f"{i}-{j}", {})
                    cell_str = str(cell) if cell else ""
                    if merge_info:
                        rowspan = merge_info.get('rowspan', 1)
                        colspan = merge_info.get('colspan', 1)
                        cell_str += f" [объединена: {rowspan}x{colspan}]"
                    row_text.append(cell_str)

            lines.append("  " + " | ".join(row_text))

        return "\n".join(lines)

    def _is_cell_hidden(self, merged_cells: Dict, row: int, col: int) -> bool:
        """
        Проверяет, скрыта ли ячейка из-за объединения.

        Args:
            merged_cells: Словарь объединенных ячеек
            row: Номер строки
            col: Номер колонки

        Returns:
            True если ячейка скрыта, иначе False
        """
        for key, merge in merged_cells.items():
            merge_row, merge_col = map(int, key.split('-'))
            rowspan = merge.get('rowspan', 1)
            colspan = merge.get('colspan', 1)

            if (row >= merge_row and row < merge_row + rowspan and
                    col >= merge_col and col < merge_col + colspan and
                    not (row == merge_row and col == merge_col)):
                return True
        return False

    def _format_item(self, item: Dict) -> str:
        """
        Рекурсивно форматирует пункт акта.

        Args:
            item: Словарь с данными пункта

        Returns:
            Отформатированный пункт
        """
        lines = []

        lines.append(f"{item['number']}. {item['title']}")

        if item.get('content'):
            lines.append(f"   {item['content']}")

        # Таблицы внутри пункта
        if item.get('tables'):
            lines.append("")
            for table_data in item['tables']:
                lines.append(self._format_table(table_data))

        # Рекурсивная обработка подпунктов
        if item.get('children'):
            for child in item['children']:
                lines.append("")
                lines.append(self._format_item(child))

        return "\n".join(lines)
