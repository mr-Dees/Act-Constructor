"""Колонтитул, размер и поля страницы под эталон.

Page: A4 210×297 мм.
Header: одно слово «Конфиденциально», жирное, jc=right, 12pt Times New Roman.
Footer: автонумерация страниц (Word-поле PAGE) по правому краю.
Margins (твипы, точно как эталон): top=567, bottom=567, left=851, right=709,
header=567, footer=397.
"""
from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Twips

from app.domains.acts.formatters.docx.styles import Fonts, Margins, Page, Sizes


def apply_header_footer(doc: Document, metadata) -> None:
    """Настраивает размер/поля страницы и наполняет верхний колонтитул."""
    section = doc.sections[0]
    section.page_width = Twips(Page.width_twips)
    section.page_height = Twips(Page.height_twips)
    section.top_margin = Twips(Margins.top)
    section.bottom_margin = Twips(Margins.bottom)
    section.left_margin = Twips(Margins.left)
    section.right_margin = Twips(Margins.right)
    section.header_distance = Twips(Margins.header)
    section.footer_distance = Twips(Margins.footer)

    header_para = section.header.paragraphs[0]
    header_para.text = ""
    header_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header_para.add_run("Конфиденциально")
    run.font.name = Fonts.main
    run.font.size = Pt(Sizes.body_pt)
    run.bold = True

    footer_para = section.footer.paragraphs[0]
    footer_para.text = ""
    footer_para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    _append_field(footer_para, "PAGE  \\* MERGEFORMAT")


def _append_field(paragraph, instr: str) -> None:
    """Вставляет Word-поле { instr } каноническими отдельными run'ами.

    begin → instrText → separate → результат → end, каждый в своём <w:r>.
    Свёрнутое в один run поле Word/LibreOffice не распознают — показывают
    литерал кэша вместо пересчёта.
    """
    def _emit(child) -> None:
        run = paragraph.add_run()
        run.font.name = Fonts.main
        run.font.size = Pt(Sizes.body_pt)
        run._r.append(child)

    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    # Помечаем поле «грязным» — Word/LibreOffice пересчитают номер при открытии.
    fld_begin.set(qn("w:dirty"), "true")
    _emit(fld_begin)

    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = f" {instr} "
    _emit(instr_text)

    fld_separate = OxmlElement("w:fldChar")
    fld_separate.set(qn("w:fldCharType"), "separate")
    _emit(fld_separate)

    result = OxmlElement("w:t")
    result.text = "1"
    _emit(result)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    _emit(fld_end)
