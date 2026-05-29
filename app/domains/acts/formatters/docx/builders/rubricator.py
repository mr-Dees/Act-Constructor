"""Плашка-рубрикатор: таблица 1x2 с заливкой и numPr в левой ячейке."""
from docx.document import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.domains.acts.formatters.docx.numbering import apply_numbering
from app.domains.acts.formatters.docx.styles import Fonts, Palette, Sizes

# Рабочая ширина листа: A4 (21см) − левое поле 1.5см − правое 1.25см = 18.25см.
USABLE_WIDTH_CM = 18.25
LEFT_CELL_CM = 0.8
RIGHT_CELL_CM = USABLE_WIDTH_CM - LEFT_CELL_CM  # 17.45см
# Ширина таблицы в твипах (dxa): 1см = 567 твипов, 18.25см ≈ 10348 твипов.
TABLE_WIDTH_DXA = round(USABLE_WIDTH_CM * 567)  # 10348


def build_rubricator_plate(doc: Document, num_id: int, title: str) -> None:
    """Добавляет плашку: таблицу 1×2, левая ячейка нумеруется, правая — заголовок.

    Плашка растянута на всю рабочую ширину листа (18.25см) с фиксированной
    раскладкой.

    После плашки вставляется пустой абзац с space_after = 1pt — визуальный
    отступ между плашкой и следующим контентом.
    """
    table = doc.add_table(rows=1, cols=2)
    table.autofit = False
    _set_table_width(table, TABLE_WIDTH_DXA)
    cells = table.rows[0].cells
    cells[0].width = Cm(LEFT_CELL_CM)
    cells[1].width = Cm(RIGHT_CELL_CM)

    for cell in cells:
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        _set_cell_shading(cell, Palette.rubricator_shade)
        _set_cell_borders(cell)

    left_para = cells[0].paragraphs[0]
    apply_numbering(left_para, num_id, ilvl=0)

    right_para = cells[1].paragraphs[0]
    run = right_para.add_run(title)
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.body_pt)
    run.bold = True

    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(0)
    spacer.paragraph_format.space_after = Pt(1)


def _set_table_width(table, width_dxa: int) -> None:
    """Задаёт явную ширину таблицы (w:tblW=dxa) и фиксированную раскладку."""
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:type"), "dxa")
    tbl_w.set(qn("w:w"), str(width_dxa))
    tbl_layout = tbl_pr.find(qn("w:tblLayout"))
    if tbl_layout is None:
        tbl_layout = OxmlElement("w:tblLayout")
        tbl_pr.append(tbl_layout)
    tbl_layout.set(qn("w:type"), "fixed")


def _set_cell_shading(cell, fill_hex: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex)
    tc_pr.append(shd)


def _set_cell_borders(cell) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for tag in ("top", "left", "bottom", "right"):
        b = OxmlElement(f"w:{tag}")
        b.set(qn("w:val"), "single")
        b.set(qn("w:sz"), "4")
        b.set(qn("w:color"), "000000")
        borders.append(b)
    tc_pr.append(borders)
