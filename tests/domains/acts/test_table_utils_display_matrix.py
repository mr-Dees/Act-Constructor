"""
Тесты build_display_matrix: резервирование позиций объединённых ячеек (isSpanned).

H3 / P7. Для таблиц с двухстрочной шапкой (метрики/риски) ячейки 2-й строки шапки
и строк данных не должны сдвигаться влево из-за rowSpan-«дырок» (isSpanned),
оставленных ячейками первой строки.
"""

from app.domains.acts.formatters.utils.table_utils import TableUtils


def _metrics_style_grid() -> list[list[dict]]:
    """
    7-колоночная таблица-метрика с ДВУХСТРОЧНОЙ шапкой (зеркало _createMetricsGrid).

    row 0: col0 rowSpan=2, col1 rowSpan=2, col2 colSpan=2 ("Кол-во"),
           col3 isSpanned(origin row0col2), col4/col5/col6 rowSpan=2.
    row 1: col0/col1 isSpanned (от rowSpan), col2/col3 — реальные подзаголовки,
           col4/col5/col6 isSpanned (от rowSpan).
    row 2: строка данных из 7 ячеек без объединений.
    """
    header_row1 = [
        {"content": "Код метрики", "isHeader": True, "colSpan": 1, "rowSpan": 2},
        {"content": "Наименование", "isHeader": True, "colSpan": 1, "rowSpan": 2},
        {"content": "Кол-во", "isHeader": True, "colSpan": 2, "rowSpan": 1},
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 2},
        },
        {"content": "Сумма, руб.", "isHeader": True, "colSpan": 1, "rowSpan": 2},
        {"content": "Код БП", "isHeader": True, "colSpan": 1, "rowSpan": 2},
        {"content": "Пункт акта", "isHeader": True, "colSpan": 1, "rowSpan": 2},
    ]
    header_row2 = [
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 0},
        },
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 1},
        },
        {"content": "ФЛ", "isHeader": True, "colSpan": 1, "rowSpan": 1},
        {"content": "ЮЛ", "isHeader": True, "colSpan": 1, "rowSpan": 1},
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 4},
        },
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 5},
        },
        {
            "content": "",
            "isHeader": True,
            "colSpan": 1,
            "rowSpan": 1,
            "isSpanned": True,
            "spanOrigin": {"row": 0, "col": 6},
        },
    ]
    data_row = [
        {"content": "M1"},
        {"content": "Метрика один"},
        {"content": "10"},
        {"content": "20"},
        {"content": "1000"},
        {"content": "BP1"},
        {"content": "5.1"},
    ]
    return [header_row1, header_row2, data_row]


def test_every_row_has_full_column_count():
    """Каждая строка матрицы имеет длину 7 (== числу колонок grid)."""
    grid = _metrics_style_grid()
    matrix = TableUtils.build_display_matrix(grid)

    assert len(matrix) == 3
    for row in matrix:
        assert len(row) == 7, f"Ожидалось 7 колонок, получено {len(row)}: {row}"


def test_data_row_values_not_shifted_left():
    """Значения строки данных стоят в своих колонках (не сдвинуты влево)."""
    grid = _metrics_style_grid()
    matrix = TableUtils.build_display_matrix(grid)

    data = matrix[2]
    assert data == ["M1", "Метрика один", "10", "20", "1000", "BP1", "5.1"]
    # Конкретно: 3-е значение остаётся на индексе 2.
    assert data[2] == "10"


def test_second_header_subheaders_land_at_correct_indices():
    """Подзаголовки 2-й строки шапки (ФЛ/ЮЛ) на индексах 2 и 3, не 0 и 1."""
    grid = _metrics_style_grid()
    matrix = TableUtils.build_display_matrix(grid)

    header2 = matrix[1]
    assert header2[2] == "ФЛ"
    assert header2[3] == "ЮЛ"
    # Позиции, занятые rowSpan-«дырками», зарезервированы пустыми строками.
    assert header2[0] == ""
    assert header2[1] == ""


def test_exact_expected_matrix():
    """Полная ожидаемая матрица для двухстрочной шапки метрик."""
    grid = _metrics_style_grid()
    matrix = TableUtils.build_display_matrix(grid)

    expected = [
        ["Код метрики", "Наименование", "Кол-во", "", "Сумма, руб.", "Код БП", "Пункт акта"],
        ["", "", "ФЛ", "ЮЛ", "", "", ""],
        ["M1", "Метрика один", "10", "20", "1000", "BP1", "5.1"],
    ]
    assert matrix == expected


def test_markdown_formatter_pipe_table_aligned():
    """
    MD-форматер: каждая строка pipe-таблицы имеет ту же ширину, что и
    разделитель после шапки (7 колонок), и подзаголовки не сдвинуты.
    """
    from app.domains.acts.formatters.markdown_formatter import MarkdownFormatter

    formatter = MarkdownFormatter.__new__(MarkdownFormatter)
    md = formatter._format_table({"grid": _metrics_style_grid()})

    lines = md.split("\n")
    # Строка 0 — шапка, строка 1 — разделитель, далее данные.
    separator = lines[1]
    sep_cols = separator.count("---")
    assert sep_cols == 7

    # Каждая строка-данные содержит ровно 7 ячеек (8 pipe-символов).
    for line in lines:
        if line.startswith("|") and "---" not in line:
            assert line.count("|") == 8, f"Ожидалось 8 разделителей: {line}"

    # Подзаголовки 2-й строки не сдвинуты влево: пустые-пустые-ФЛ-ЮЛ.
    second_header = lines[2]
    cells = [c.strip() for c in second_header.strip("|").split("|")]
    assert cells == ["", "", "ФЛ", "ЮЛ", "", "", ""]
