"""
Утилиты для работы с табличными данными.

Обрабатывает grid-структуры с поддержкой colspan/rowspan.
"""


class TableUtils:
    """Stateless класс-утилита для работы с таблицами."""

    @staticmethod
    def build_display_matrix(grid: list[list[dict]]) -> list[list[str]]:
        """
        Преобразует grid-структуру в матрицу строк для отображения.

        Обрабатывает:
        - Объединенные ячейки (colspan)
        - Поглощенные ячейки (isSpanned)
        - Выравнивание до максимальной ширины

        Args:
            grid: Двумерный массив ячеек с метаданными.
                Каждая ячейка: {content, colSpan, isSpanned, ...}

        Returns:
            Матрица строк одинаковой ширины
        """
        display_matrix = []
        max_cols = 0

        for row_data in grid:
            display_row = []

            for cell_data in row_data:
                # Пропускаем поглощенные ячейки
                if cell_data.get("isSpanned", False):
                    continue

                # Извлекаем содержимое и colspan
                content = str(cell_data.get("content", ""))
                colspan = cell_data.get("colSpan", 1)

                # Первая ячейка получает содержимое
                display_row.append(content)

                # Остальные ячейки в colspan - пустые
                for _ in range(colspan - 1):
                    display_row.append("")

            if display_row:
                display_matrix.append(display_row)
                max_cols = max(max_cols, len(display_row))

        # Выравнивание всех строк до максимальной ширины
        for row in display_matrix:
            while len(row) < max_cols:
                row.append("")

        return display_matrix

    @staticmethod
    def calculate_column_widths(matrix: list[list[str]]) -> list[int]:
        """
        Вычисляет оптимальную ширину колонок для ASCII-таблицы.

        Args:
            matrix: Матрица строк (результат build_display_matrix)

        Returns:
            Ширина каждой колонки в символах
        """
        if not matrix:
            return []

        num_cols = len(matrix[0])
        col_widths = [0] * num_cols

        for row in matrix:
            for col_idx, cell_text in enumerate(row):
                col_widths[col_idx] = max(
                    col_widths[col_idx],
                    len(str(cell_text)),
                )

        return col_widths

    @staticmethod
    def escape_markdown_pipes(text: str) -> str:
        """
        Экранирует pipe символы для Markdown таблиц.

        Args:
            text: Текст ячейки

        Returns:
            Текст с экранированными |
        """
        return text.replace("|", "\\|")

    @staticmethod
    def has_merged_cells(grid: list[list[dict]]) -> bool:
        """
        Проверяет наличие объединенных ячеек в таблице.

        Args:
            grid: Сетка ячеек

        Returns:
            True если есть ячейки с colSpan > 1 или rowSpan > 1
        """
        for row in grid:
            for cell in row:
                if cell.get("colSpan", 1) > 1 or cell.get("rowSpan", 1) > 1:
                    return True
        return False
