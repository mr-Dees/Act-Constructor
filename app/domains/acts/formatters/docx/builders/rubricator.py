"""Плашка-рубрикатор: таблица 1x2 с заливкой и numPr в левой ячейке."""
from docx.document import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.domains.acts.formatters.docx.numbering import apply_numbering
from app.domains.acts.formatters.docx.styles import Fonts, Palette, Sizes


def build_rubricator_plate(doc: Document, num_id: int, title: str) -> None:
    """Добавляет плашку: таблицу 1×2, левая ячейка нумеруется, правая — заголовок.

    После плашки вставляется пустой абзац с space_after = 1pt — визуальный
    отступ между плашкой и следующим контентом.
    """
    table = doc.add_table(rows=1, cols=2)
    table.autofit = False
    cells = table.rows[0].cells
    cells[0].width = Cm(0.8)
    cells[1].width = Cm(15.7)

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
