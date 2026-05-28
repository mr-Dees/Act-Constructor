"""Тесты native footnote-регистра."""
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.footnotes import add_footnote


def test_add_footnote_returns_increasing_id(doc):
    p = doc.add_paragraph()
    fid1 = add_footnote(p, "Первая сноска")
    p2 = doc.add_paragraph()
    fid2 = add_footnote(p2, "Вторая сноска")
    assert fid2 == fid1 + 1


def test_paragraph_has_footnote_reference(doc):
    p = doc.add_paragraph("Текст")
    fid = add_footnote(p, "Сноска")
    refs = p._p.findall(f".//{qn('w:footnoteReference')}")
    assert len(refs) == 1
    assert refs[0].get(qn("w:id")) == str(fid)


def test_footnotes_part_contains_text(doc):
    p = doc.add_paragraph()
    add_footnote(p, "Уникальный текст сноски XYZ123")
    footnotes_part = doc.part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
    assert b"XYZ123" in footnotes_part.blob
