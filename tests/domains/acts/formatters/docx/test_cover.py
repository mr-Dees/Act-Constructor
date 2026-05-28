"""Тесты cover-таблицы."""
from datetime import date

import pytest
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.cover import build_cover_block
from app.domains.acts.formatters.docx.styles import Fonts


class _Meta:
    """Минимальный объект metadata для тестов."""
    def __init__(self, **kw):
        self.km_number = kw.get("km_number", "КМ-99-99999")
        self.part_number = kw.get("part_number", 1)
        self.total_parts = kw.get("total_parts", 1)
        self.inspection_name = kw.get("inspection_name", "Проверка X")
        self.is_process_based = kw.get("is_process_based", False)
        self.inspection_start_date = kw.get("start", date(2026, 3, 1))
        self.inspection_end_date = kw.get("end", date(2026, 4, 30))
        self.order_number = kw.get("order", "Text/2026/15-Б")
        self.audit_team = kw.get("team", [])


def test_cover_creates_table_without_visible_borders(doc):
    build_cover_block(doc, _Meta())
    table = doc.tables[0]
    tbl_pr = table._element.find(qn("w:tblPr"))
    borders = tbl_pr.find(qn("w:tblBorders"))
    assert borders is not None
    for tag in ("top", "left", "bottom", "right", "insideH", "insideV"):
        border = borders.find(qn(f"w:{tag}"))
        assert border is not None
        assert border.get(qn("w:val")) == "nil"


def test_cover_contains_km_number(doc):
    build_cover_block(doc, _Meta(km_number="КМ-99-12345"))
    text = doc.tables[0].rows[0].cells[0].text
    assert "КМ-99-12345" in text


def test_cover_contains_inspection_type_label(doc):
    build_cover_block(doc, _Meta(is_process_based=False))
    text = doc.tables[0].rows[0].cells[0].text
    assert "епроцессная" in text  # «Непроцессная»


def test_act_title_paragraph_is_bold_14pt_centered(doc):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    build_cover_block(doc, _Meta(inspection_name="Проверка овернайт-выписок"))
    paragraphs = [p for p in doc.paragraphs if p.text]
    title = paragraphs[-1]
    assert title.alignment == WD_ALIGN_PARAGRAPH.CENTER
    assert title.runs[0].bold is True
    assert title.runs[0].font.size == Pt(14)
    assert title.runs[0].font.name == Fonts.main
    assert "ПРОВЕРКА ОВЕРНАЙТ-ВЫПИСОК" in title.text.upper()
