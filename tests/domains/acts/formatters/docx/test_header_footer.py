"""Тесты колонтитула и полей страницы."""
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Cm

from app.domains.acts.formatters.docx.builders.header_footer import apply_header_footer
from app.domains.acts.formatters.docx.styles import Margins


class _Meta:
    def __init__(self, km="КМ-99-99999", part=1):
        self.km_number = km
        self.part_number = part


def test_margins_applied(doc):
    apply_header_footer(doc, _Meta())
    section = doc.sections[0]
    assert round(section.top_margin.cm, 2) == Margins.top_cm
    assert round(section.bottom_margin.cm, 2) == Margins.bottom_cm
    assert round(section.left_margin.cm, 2) == Margins.left_cm
    assert round(section.right_margin.cm, 2) == Margins.right_cm


def test_header_contains_km_number(doc):
    apply_header_footer(doc, _Meta(km="КМ-77-77777"))
    header_text = doc.sections[0].header.paragraphs[0].text
    assert "КМ-77-77777" in header_text


def test_header_contains_page_field(doc):
    apply_header_footer(doc, _Meta())
    header_xml = doc.sections[0].header.paragraphs[0]._p.xml
    assert "PAGE" in header_xml
    assert "NUMPAGES" in header_xml


def test_footer_is_empty(doc):
    apply_header_footer(doc, _Meta())
    assert doc.sections[0].footer.paragraphs[0].text == ""
