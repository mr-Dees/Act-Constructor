"""Плашка-рубрикатор: таблица 1x2 с заливкой и numPr в левой ячейке."""
from docx.document import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, Twips

from app.domains.acts.formatters.docx.numbering import apply_numbering
from app.domains.acts.formatters.docx.styles import Fonts, Palette, Sizes

# Рабочая ширина листа = ширина A4 − левое поле − правое поле (в твипах):
# 11906 − 851 − 709 = 10346. Точно совпадает с шириной основного текста.
TABLE_WIDTH_DXA = 11906 - 851 - 709  # 10346
LEFT_CELL_CM = 0.8
RIGHT_CELL_CM = round(TABLE_WIDTH_DXA / 567 - LEFT_CELL_CM, 2)
# Высота строки плашки чуть больше строки текста — как в эталоне.
PLATE_ROW_HEIGHT_TWIPS = 510  # ~0.9 см


def build_rubricator_plate(doc: Document, num_id: int, title: str) -> None:
    """Добавляет плашку: таблицу 1×2, левая ячейка нумеруется, правая — заголовок.

    Плашка растянута на всю рабочую ширину листа (18.25см) с фиксированной
    раскладкой. Пустые строки-распорки до/после плашки добавляет вызывающий
    код (formatter), чтобы централизованно управлять «воздухом».
    """
    table = doc.add_table(rows=1, cols=2)
    table.autofit = False
    _set_table_width(table, TABLE_WIDTH_DXA)
    # Чуть выше строки текста — как в эталоне.
    row = table.rows[0]
    row.height = Twips(PLATE_ROW_HEIGHT_TWIPS)
    row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
    cells = row.cells
    cells[0].width = Cm(LEFT_CELL_CM)
    cells[1].width = Cm(RIGHT_CELL_CM)

    for cell in cells:
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        _set_cell_shading(cell, Palette.rubricator_shade)
        _set_cell_borders(cell)

    # Номер рубрикатора — обычный текст 12pt (не 9pt таблиц), выровнен вправо.
    left_para = cells[0].paragraphs[0]
    left_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    apply_numbering(left_para, num_id, ilvl=0)
    _set_paragraph_mark_size(left_para, Sizes.body_pt)

    right_para = cells[1].paragraphs[0]
    run = right_para.add_run(title)
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.body_pt)
    run.bold = True


def _set_paragraph_mark_size(paragraph, size_pt: int) -> None:
    """Задаёт размер метки абзаца — управляет кеглем автономера без текстового run."""
    p_pr = paragraph._p.get_or_add_pPr()
    r_pr = p_pr.find(qn("w:rPr"))
    if r_pr is None:
        r_pr = OxmlElement("w:rPr")
        p_pr.append(r_pr)
    for tag in ("w:sz", "w:szCs"):
        el = OxmlElement(tag)
        el.set(qn("w:val"), str(size_pt * 2))
        r_pr.append(el)


def _set_table_width(table, width_dxa: int) -> None:
    """Растягивает плашку на 100% колонки текста (w:tblW type="pct") — как в эталоне.

    Эталон не задаёт w:tblInd и ставит ширину в процентах, тогда края плашки
    совпадают с краями текста и контент-таблиц. Ширины ячеек (Cm) задают
    пропорцию колонок при fixed-раскладке. width_dxa оставлен для совместимости
    сигнатуры, но как абсолют не используется.
    """
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:type"), "pct")
    tbl_w.set(qn("w:w"), "5000")  # 5000 = 100%
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
