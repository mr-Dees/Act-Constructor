"""Builder обычных таблиц (metrics / risk / generic) из TableSchema."""
from docx.document import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.styles import Borders, Fonts, Palette, Sizes
from app.domains.acts.schemas.act_content import TableSchema


def build_table(doc: Document, schema: TableSchema) -> None:
    """Создаёт docx-таблицу по схеме TableSchema (учитывает colSpan / rowSpan)."""
    rows = len(schema.grid)
    cols = len(schema.grid[0]) if rows else 0
    if rows == 0 or cols == 0:
        return

    table = doc.add_table(rows=rows, cols=cols)
    _apply_borders(table)

    for r, row in enumerate(schema.grid):
        for c, cell_schema in enumerate(row):
            if cell_schema.isSpanned:
                continue
            cell = table.rows[r].cells[c]
            if cell_schema.colSpan > 1 or cell_schema.rowSpan > 1:
                _merge_cells(table, r, c, cell_schema.colSpan, cell_schema.rowSpan)

            _fill_cell(cell, cell_schema.content, is_header=cell_schema.isHeader)


def _apply_borders(table) -> None:
    tbl_pr = table._element.find(qn("w:tblPr"))
    borders = OxmlElement("w:tblBorders")
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement(f"w:{tag}")
        b.set(qn("w:val"), Borders.table_default["val"])
        b.set(qn("w:sz"), str(Borders.table_default["sz"]))  # 4 × 1/8pt = 0.5pt
        b.set(qn("w:color"), Palette.table_border)
        borders.append(b)
    tbl_pr.append(borders)


def _merge_cells(table, r, c, col_span: int, row_span: int) -> None:
    end_r = r + row_span - 1
    end_c = c + col_span - 1
    start_cell = table.rows[r].cells[c]
    end_cell = table.rows[end_r].cells[end_c]
    start_cell.merge(end_cell)


def _fill_cell(cell, text: str, *, is_header: bool) -> None:
    if is_header:
        _set_cell_shade(cell, Palette.table_header_shade)
    para = cell.paragraphs[0]
    # Удаляем все существующие runs из XML-параграфа перед добавлением своего
    for r_el in para._p.findall(qn("w:r")):
        para._p.remove(r_el)
    run = para.add_run(text or "")
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.table_header_pt if is_header else Sizes.table_data_pt)
    run.bold = is_header


def _set_cell_shade(cell, fill_hex: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_hex)
    tc_pr.append(shd)
