"""Header содержит только «Конфиденциально» right; footer — PAGE-поле по центру; margins под эталон."""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm

from app.domains.acts.formatters.docx.builders.header_footer import apply_header_footer


class _MetaStub:
    km_number = "КМ-99-99999"
    part_number = 1


def test_margins_applied_from_etalon():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    section = doc.sections[0]
    assert round(section.top_margin.cm, 2) == 1.0
    assert round(section.bottom_margin.cm, 2) == 1.0
    assert round(section.left_margin.cm, 2) == 1.5
    assert round(section.right_margin.cm, 2) == 1.25


def test_header_has_single_confidential_paragraph_right():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    header = doc.sections[0].header
    paragraphs = [p for p in header.paragraphs if p.text]
    assert len(paragraphs) == 1
    assert paragraphs[0].text == "Конфиденциально"
    assert paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.RIGHT


def test_header_does_not_contain_page_field():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    header = doc.sections[0].header
    xml = header.paragraphs[0]._p.xml
    assert "PAGE" not in xml
    assert "NUMPAGES" not in xml


def test_footer_has_centered_page_field():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    footer_para = doc.sections[0].footer.paragraphs[0]
    assert footer_para.alignment == WD_ALIGN_PARAGRAPH.CENTER
    instr_texts = footer_para._p.findall(
        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}instrText"
    )
    assert any("PAGE" in (el.text or "") for el in instr_texts)
