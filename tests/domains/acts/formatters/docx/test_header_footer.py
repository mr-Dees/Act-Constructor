"""Header содержит только «Конфиденциально» right жирным; footer — PAGE-поле по правому краю.

Размер страницы A4 и поля — точно как эталон (в твипах).
"""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.builders.header_footer import apply_header_footer


class _MetaStub:
    km_number = "КМ-99-99999"
    part_number = 1


def test_page_size_is_a4():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    section = doc.sections[0]
    assert section.page_width.twips == 11906
    assert section.page_height.twips == 16838


def test_margins_applied_from_etalon():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    section = doc.sections[0]
    assert section.top_margin.twips == 567
    assert section.bottom_margin.twips == 567
    assert section.left_margin.twips == 851
    assert section.right_margin.twips == 709
    assert section.header_distance.twips == 567
    assert section.footer_distance.twips == 397


def test_header_has_single_confidential_paragraph_right_bold():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    header = doc.sections[0].header
    paragraphs = [p for p in header.paragraphs if p.text]
    assert len(paragraphs) == 1
    assert paragraphs[0].text == "Конфиденциально"
    assert paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.RIGHT
    conf_run = next(r for r in paragraphs[0].runs if r.text)
    assert conf_run.bold is True


def test_header_does_not_contain_page_field():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    header = doc.sections[0].header
    xml = header.paragraphs[0]._p.xml
    assert "PAGE" not in xml
    assert "NUMPAGES" not in xml


def test_footer_has_right_aligned_page_field():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    footer_para = doc.sections[0].footer.paragraphs[0]
    assert footer_para.alignment == WD_ALIGN_PARAGRAPH.RIGHT
    instr_texts = footer_para._p.findall(
        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}instrText"
    )
    assert any("PAGE" in (el.text or "") for el in instr_texts)


def test_footer_page_field_begin_is_dirty():
    doc = Document()
    apply_header_footer(doc, _MetaStub())
    footer_para = doc.sections[0].footer.paragraphs[0]
    fld_chars = footer_para._p.findall(
        ".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fldChar"
    )
    begin = next(
        el for el in fld_chars if el.get(qn("w:fldCharType")) == "begin"
    )
    assert begin.get(qn("w:dirty")) == "true"
