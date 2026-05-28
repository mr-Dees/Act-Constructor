"""Колонтитул и поля страницы."""
from docx.document import Document
from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

from app.domains.acts.formatters.docx.styles import Fonts, Margins, Sizes


def apply_header_footer(doc: Document, metadata) -> None:
    """Настраивает поля страницы и наполняет верхний колонтитул."""
    section = doc.sections[0]
    section.top_margin = Cm(Margins.top_cm)
    section.bottom_margin = Cm(Margins.bottom_cm)
    section.left_margin = Cm(Margins.left_cm)
    section.right_margin = Cm(Margins.right_cm)

    header = section.header
    header_para = header.paragraphs[0]
    header_para.text = ""

    page_width_pt = section.page_width.pt - section.left_margin.pt - section.right_margin.pt
    tab_stops = header_para.paragraph_format.tab_stops
    tab_stops.add_tab_stop(Pt(page_width_pt), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.SPACES)

    left_run = header_para.add_run(f"Акт {metadata.km_number}, часть {metadata.part_number}\t")
    left_run.font.name = Fonts.main
    left_run.font.size = Pt(Sizes.footnote_pt)

    _append_page_field(header_para)

    footer_para = section.footer.paragraphs[0]
    footer_para.text = ""


def _append_page_field(paragraph) -> None:
    """Вставляет «PAGE / NUMPAGES» через w:fldChar в конец параграфа."""
    run_page = paragraph.add_run()
    _add_field(run_page, "PAGE")
    sep_run = paragraph.add_run(" / ")
    sep_run.font.name = Fonts.main
    sep_run.font.size = Pt(Sizes.footnote_pt)
    run_total = paragraph.add_run()
    _add_field(run_total, "NUMPAGES")


def _add_field(run, instr: str) -> None:
    """Записывает w:fldChar begin + w:instrText + w:fldChar end в run."""
    r = run._r
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    r.append(fld_begin)

    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = f" {instr} "
    r.append(instr_text)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    r.append(fld_end)

    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.footnote_pt)
