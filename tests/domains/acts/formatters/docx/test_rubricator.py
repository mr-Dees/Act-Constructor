"""Тесты плашки-рубрикатора."""
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.domains.acts.formatters.docx.numbering import ensure_rubricator
from app.domains.acts.formatters.docx.builders.rubricator import (
    build_rubricator_plate,
    LEFT_CELL_CM,
    RIGHT_CELL_CM,
    TABLE_WIDTH_DXA,
    USABLE_WIDTH_CM,
)
from app.domains.acts.formatters.docx.styles import Palette, Fonts, Sizes


def test_plate_creates_table_1x2(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Предмет проверки")
    table = doc.tables[0]
    assert len(table.rows) == 1
    assert len(table.rows[0].cells) == 2


def test_cell_widths_span_usable_width(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Предмет проверки")
    cells = doc.tables[0].rows[0].cells
    # python-docx хранит ширину ячейки в твипах, поэтому допускаем
    # потерю на округлении EMU↔твипы (≈1 твип ≈ 635 EMU).
    assert abs(cells[0].width - Cm(LEFT_CELL_CM)) < 700
    assert abs(cells[1].width - Cm(RIGHT_CELL_CM)) < 700
    # Сумма ширин ячеек ≈ рабочая ширина листа 18.25см.
    assert abs((cells[0].width + cells[1].width) - Cm(USABLE_WIDTH_CM)) < 1400


def test_table_has_fixed_width_in_dxa(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Предмет проверки")
    tbl_pr = doc.tables[0]._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    assert tbl_w is not None
    assert tbl_w.get(qn("w:type")) == "dxa"
    assert tbl_w.get(qn("w:w")) == str(TABLE_WIDTH_DXA)
    assert TABLE_WIDTH_DXA == 10348
    tbl_layout = tbl_pr.find(qn("w:tblLayout"))
    assert tbl_layout is not None
    assert tbl_layout.get(qn("w:type")) == "fixed"


def test_both_cells_have_shading(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Предмет проверки")
    for cell in doc.tables[0].rows[0].cells:
        tc_pr = cell._tc.find(qn("w:tcPr"))
        shd = tc_pr.find(qn("w:shd"))
        assert shd is not None
        assert shd.get(qn("w:fill")).upper() == Palette.rubricator_shade


def test_left_cell_has_numpr_and_is_empty(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Предмет")
    left = doc.tables[0].rows[0].cells[0]
    para = left.paragraphs[0]
    assert para.text == ""
    num_pr = para._p.find(qn("w:pPr")).find(qn("w:numPr"))
    assert num_pr is not None
    assert num_pr.find(qn("w:ilvl")).get(qn("w:val")) == "0"
    assert num_pr.find(qn("w:numId")).get(qn("w:val")) == str(num_id)


def test_right_cell_has_bold_12pt_title(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Результаты проверки")
    right = doc.tables[0].rows[0].cells[1]
    run = right.paragraphs[0].runs[0]
    assert run.text == "Результаты проверки"
    assert run.bold is True
    assert run.font.size == Pt(Sizes.body_pt)
    assert run.font.name == Fonts.main


def test_multiple_plates_share_same_num_id(doc):
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Раздел 1")
    build_rubricator_plate(doc, num_id, "Раздел 2")
    found_num_ids = set()
    for table in doc.tables:
        para = table.rows[0].cells[0].paragraphs[0]
        nid = para._p.find(qn("w:pPr")).find(qn("w:numPr")).find(qn("w:numId"))
        found_num_ids.add(nid.get(qn("w:val")))
    assert found_num_ids == {str(num_id)}
