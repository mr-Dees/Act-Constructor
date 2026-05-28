"""Cover-блок: таблица-реквизиты без видимых рамок + заголовок акта."""
from datetime import date

from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.styles import Fonts, Sizes


def build_cover_block(doc: Document, metadata) -> None:
    """Добавляет cover-таблицу и заголовок акта в начало документа."""
    table = doc.add_table(rows=1, cols=2)
    _set_invisible_borders(table)

    left_lines = _build_meta_lines(metadata)
    left_cell = table.rows[0].cells[0]
    left_cell.text = ""  # сбрасываем default-параграф
    for i, line in enumerate(left_lines):
        para = left_cell.paragraphs[0] if i == 0 else left_cell.add_paragraph()
        run = para.add_run(line)
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.label_pt)

    right_cell = table.rows[0].cells[1]
    right_cell.text = ""
    placeholder = right_cell.paragraphs[0].add_run("[ЛОГОТИП]")
    placeholder.font.name = Fonts.main
    placeholder.font.size = Pt(Sizes.label_pt)
    right_cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT

    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_run = title.add_run(_build_title(metadata))
    title_run.font.name = Fonts.main
    title_run.font.size = Pt(Sizes.title_pt)
    title_run.bold = True


def _build_meta_lines(m) -> list:
    type_label = "Процессная проверка" if m.is_process_based else "Непроцессная проверка"
    start = m.inspection_start_date.strftime("%d.%m.%Y") if m.inspection_start_date else ""
    end = m.inspection_end_date.strftime("%d.%m.%Y") if m.inspection_end_date else ""
    return [
        f"{m.km_number}, часть {m.part_number} из {m.total_parts}",
        type_label,
        f"Период проверки: {start} – {end}",
        f"Распоряжение: {m.order_number}",
    ]


def _build_title(m) -> str:
    name = (m.inspection_name or "").strip()
    return f"АКТ ПРОВЕРКИ\n{name}" if name else "АКТ ПРОВЕРКИ"


def _set_invisible_borders(table) -> None:
    tbl_pr = table._element.find(qn("w:tblPr"))
    borders = OxmlElement("w:tblBorders")
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        b = OxmlElement(f"w:{tag}")
        b.set(qn("w:val"), "nil")
        borders.append(b)
    tbl_pr.append(borders)
