"""Тесты builder'а таблиц."""
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.tables import build_table
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
