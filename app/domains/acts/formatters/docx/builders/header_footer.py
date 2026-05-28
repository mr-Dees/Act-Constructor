"""Колонтитул и поля страницы под эталон.

Header: одно слово «Конфиденциально», jc=right, 12pt Calibri.
Footer: пустой (в эталоне footer не используется).
Margins: top=1.0, bottom=1.0, left=1.5, right=1.25 см.
"""
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
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

    section.footer.paragraphs[0].text = ""
