"""Колонтитул и поля страницы под эталон.

Header: одно слово «Конфиденциально», jc=right, 12pt Calibri.
Footer: автонумерация страниц (Word-поле PAGE) по центру.
Margins: top=1.0, bottom=1.0, left=1.5, right=1.25 см.
"""
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
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

    header_para = section.header.paragraphs[0]
    header_para.text = ""
    header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header_para.add_run("Конфиденциально")
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.body_pt)

    footer_para = section.footer.paragraphs[0]
    footer_para.text = ""
    footer_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _append_field(footer_para, " PAGE  \\* MERGEFORMAT ")


def _append_field(paragraph, instr: str) -> None:
    """Вставляет Word-поле { instr } через w:fldChar в указанный параграф."""
    run = paragraph.add_run()
    r = run._r

    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    r.append(fld_begin)

    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = instr
    r.append(instr_text)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    r.append(fld_end)

    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.body_pt)
