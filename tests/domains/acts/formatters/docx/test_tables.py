"""Тесты builder'а таблиц."""
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.tables import (
    USABLE_WIDTH_DXA,
    build_table,
)
from app.domains.acts.formatters.docx.styles import Fonts, Palette, Sizes
from app.domains.acts.schemas.act_content import TableCellSchema, TableSchema


def _ts(grid_data, **kw):
    grid = [[TableCellSchema(**c) for c in row] for row in grid_data]
    return TableSchema(id="t1", nodeId="n1", grid=grid, **kw)


def test_table_dimensions(doc):
    schema = _ts([
        [{"content": "A", "isHeader": True}, {"content": "B", "isHeader": True}],
        [{"content": "1"}, {"content": "2"}],
    ])
    build_table(doc, schema)
    table = doc.tables[0]
    assert len(table.rows) == 2
    assert len(table.rows[0].cells) == 2


def test_header_cell_has_shade_and_bold(doc):
    schema = _ts([
        [{"content": "Шапка", "isHeader": True}],
        [{"content": "Данные"}],
    ])
    build_table(doc, schema)
    header_cell = doc.tables[0].rows[0].cells[0]
    tc_pr = header_cell._tc.find(qn("w:tcPr"))
    shd = tc_pr.find(qn("w:shd"))
    assert shd.get(qn("w:fill")).upper() == Palette.table_header_shade
    run = header_cell.paragraphs[0].runs[0]
    assert run.bold is True
    assert run.font.size == Pt(Sizes.table_header_pt)


def test_data_cell_font_9pt_tnr(doc):
    schema = _ts([
        [{"content": "h", "isHeader": True}],
        [{"content": "обычная ячейка"}],
    ])
    build_table(doc, schema)
    cell = doc.tables[0].rows[1].cells[0]
    run = cell.paragraphs[0].runs[0]
    assert run.font.name == Fonts.main
    assert run.font.size == Pt(Sizes.table_data_pt)
    assert not run.bold


def test_borders_single_05pt(doc):
    schema = _ts([[{"content": "x"}]])
    build_table(doc, schema)
    tbl_borders = doc.tables[0]._element.find(qn("w:tblPr")).find(qn("w:tblBorders"))
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = tbl_borders.find(qn(f"w:{tag}"))
        assert b.get(qn("w:val")) == "single"
        assert b.get(qn("w:sz")) == "4"


def test_empty_cell_mark_is_9pt(doc):
    """Пустая ячейка тоже 9pt — размер задаётся метке абзаца (sz=18)."""
    schema = _ts([[{"content": ""}]])
    build_table(doc, schema)
    cell = doc.tables[0].rows[0].cells[0]
    p_pr = cell.paragraphs[0]._p.find(qn("w:pPr"))
    sz = p_pr.find(qn("w:rPr")).find(qn("w:sz"))
    assert sz is not None
    assert sz.get(qn("w:val")) == str(Sizes.table_data_pt * 2)


def test_cells_centered_horizontally_and_vertically(doc):
    """Все ячейки выровнены по центру по ширине (jc=center) и высоте (vAlign=center)."""
    schema = _ts([
        [{"content": "A", "isHeader": True}, {"content": "B", "isHeader": True}],
        [{"content": "1"}, {"content": ""}],
    ])
    build_table(doc, schema)
    table = doc.tables[0]
    for row in table.rows:
        for cell in row.cells:
            assert cell.vertical_alignment == WD_CELL_VERTICAL_ALIGNMENT.CENTER
            assert cell.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER


def test_merged_header_cell_is_left_aligned(doc):
    """Объединённая по горизонтали ячейка (colSpan>1) выровнена влево (LEFT,
    не JUSTIFY — предпросмотр совпадает с .docx), одиночная — по центру."""
    schema = _ts([
        [
            {"content": "ОР", "isHeader": True},
            {"content": "Отклонения с признаками ОР", "isHeader": True, "colSpan": 2},
            {"content": "", "isSpanned": True},
        ],
        [{"content": "a"}, {"content": "b"}, {"content": "c"}],
    ])
    build_table(doc, schema)
    table = doc.tables[0]
    single = table.rows[0].cells[0]
    merged = table.rows[0].cells[1]
    assert single.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert merged.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.LEFT


def test_risk_title_phrases_are_left_aligned(doc):
    """Заголовки риск-таблиц «Выявлены налоговые риски» (colSpan=6) и
    «Отклонения с признаками операционного риска (далее - ОР)» (colSpan=5)
    прижаты влево — должны совпадать с предпросмотром."""
    tax = _ts([
        [{"content": "Выявлены налоговые риски", "isHeader": True, "colSpan": 6}]
        + [{"content": "", "isSpanned": True}] * 5,
        [{"content": str(i)} for i in range(6)],
    ])
    build_table(doc, tax)
    assert doc.tables[0].rows[0].cells[0].paragraphs[0].alignment == \
        WD_ALIGN_PARAGRAPH.LEFT

    op = _ts([
        [{"content": "Отклонения с признаками операционного риска (далее - ОР)",
          "isHeader": True, "colSpan": 5}]
        + [{"content": "", "isSpanned": True}] * 4,
        [{"content": str(i)} for i in range(5)],
    ])
    build_table(doc, op)
    assert doc.tables[1].rows[0].cells[0].paragraphs[0].alignment == \
        WD_ALIGN_PARAGRAPH.LEFT


def test_table_has_no_left_indent(doc):
    """Эталон не задаёт tblInd — иначе таблица смещается от края текста."""
    schema = _ts([[{"content": "x"}]])
    build_table(doc, schema)
    tbl_ind = doc.tables[0]._tbl.tblPr.find(qn("w:tblInd"))
    assert tbl_ind is None


def test_table_width_is_full_percent_fixed_layout(doc):
    """(13) tblW=pct 5000 (100% колонки текста), раскладка fixed, gridCol = USABLE."""
    schema = _ts(
        [
            [{"content": "A", "isHeader": True}, {"content": "B", "isHeader": True},
             {"content": "C", "isHeader": True}],
            [{"content": "1"}, {"content": "2"}, {"content": "3"}],
        ],
        colWidths=[100, 200, 300],
    )
    build_table(doc, schema)
    tbl = doc.tables[0]._tbl
    tbl_pr = tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    assert tbl_w.get(qn("w:type")) == "pct"
    assert tbl_w.get(qn("w:w")) == "5000"
    assert tbl_pr.find(qn("w:tblLayout")).get(qn("w:type")) == "fixed"
    # Сумма gridCol строго равна USABLE.
    grid = tbl.find(qn("w:tblGrid"))
    total = sum(int(c.get(qn("w:w"))) for c in grid.findall(qn("w:gridCol")))
    assert total == USABLE_WIDTH_DXA
    # Колонки распределены пропорционально colWidths.
    cols = [int(c.get(qn("w:w"))) for c in grid.findall(qn("w:gridCol"))]
    assert cols[0] < cols[1] < cols[2]


def test_table_width_equal_split_when_colwidths_empty(doc):
    """(13) Пустой colWidths → колонки поровну, сумма всё равно = USABLE."""
    schema = _ts([
        [{"content": "A"}, {"content": "B"}],
        [{"content": "1"}, {"content": "2"}],
    ])
    build_table(doc, schema)
    grid = doc.tables[0]._tbl.find(qn("w:tblGrid"))
    cols = [int(c.get(qn("w:w"))) for c in grid.findall(qn("w:gridCol"))]
    assert sum(cols) == USABLE_WIDTH_DXA
    assert abs(cols[0] - cols[1]) <= 1


def test_count_clients_cell_centered_even_when_merged(doc):
    """(8) «Количество клиентов / элементов, ед.» при colSpan>1 → CENTER,
    другая склеенная ячейка прижата влево (LEFT)."""
    schema = _ts([
        [
            {"content": "Количество клиентов  / элементов, ед.",
             "isHeader": True, "colSpan": 2},
            {"content": "", "isSpanned": True},
            {"content": "Прочие отклонения", "isHeader": True, "colSpan": 2},
            {"content": "", "isSpanned": True},
        ],
        [
            {"content": "a"}, {"content": "b"}, {"content": "c"}, {"content": "d"},
        ],
    ])
    build_table(doc, schema)
    table = doc.tables[0]
    clients = table.rows[0].cells[0]
    other = table.rows[0].cells[2]
    assert clients.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert other.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.LEFT


def test_pagination_cant_split_all_rows(doc):
    """(4) cantSplit проставлен на КАЖДУЮ строку."""
    schema = _ts([
        [{"content": "H", "isHeader": True}],
        [{"content": "1"}],
        [{"content": "2"}],
    ])
    build_table(doc, schema)
    for row in doc.tables[0].rows:
        tr_pr = row._tr.find(qn("w:trPr"))
        assert tr_pr is not None
        assert tr_pr.find(qn("w:cantSplit")) is not None


def test_pagination_tbl_header_single_row_header(doc):
    """(4) tblHeader на единственной строке шапки, не на данных."""
    schema = _ts([
        [{"content": "H", "isHeader": True}],
        [{"content": "1"}],
    ])
    build_table(doc, schema)
    rows = doc.tables[0].rows
    assert rows[0]._tr.find(qn("w:trPr")).find(qn("w:tblHeader")) is not None
    data_tr_pr = rows[1]._tr.find(qn("w:trPr"))
    assert data_tr_pr.find(qn("w:tblHeader")) is None


def test_pagination_multirow_header_tbl_header_and_keepnext(doc):
    """(4) Многострочная шапка (2 строки): tblHeader на обеих строках шапки,
    keep_with_next на абзацах ячеек шапки, на данных — нет."""
    schema = _ts([
        [{"content": "Группа", "isHeader": True}, {"content": "Подгруппа", "isHeader": True}],
        [{"content": "h1", "isHeader": True}, {"content": "h2", "isHeader": True}],
        [{"content": "1"}, {"content": "2"}],
    ])
    build_table(doc, schema)
    rows = doc.tables[0].rows
    # tblHeader на обеих строках шапки.
    assert rows[0]._tr.find(qn("w:trPr")).find(qn("w:tblHeader")) is not None
    assert rows[1]._tr.find(qn("w:trPr")).find(qn("w:tblHeader")) is not None
    # На строке данных tblHeader нет.
    assert rows[2]._tr.find(qn("w:trPr")).find(qn("w:tblHeader")) is None
    # keep_with_next на абзацах ячеек шапки.
    for idx in (0, 1):
        for cell in rows[idx].cells:
            assert cell.paragraphs[0].paragraph_format.keep_with_next is True
    # На данных keep_with_next не выставлен (None или False).
    assert not rows[2].cells[0].paragraphs[0].paragraph_format.keep_with_next


def test_skips_spanned_cells(doc):
    """isSpanned=True ячейки пропускаются в matrix → merge."""
    schema = _ts([
        [
            {"content": "Шапка", "isHeader": True, "colSpan": 2},
            {"content": "", "isSpanned": True},
        ],
        [{"content": "1"}, {"content": "2"}],
    ])
    build_table(doc, schema)
    merged = doc.tables[0].rows[0].cells[0]
    assert "Шапка" in merged.text
