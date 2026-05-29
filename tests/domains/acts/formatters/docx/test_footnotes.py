"""Тесты native footnote-регистра."""
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.footnotes import add_footnote
from app.domains.acts.formatters.docx.styles import Sizes


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


def test_reference_marker_is_superscript(doc):
    """Циферка-маркер в тексте абзаца — надстрочная (как степень)."""
    p = doc.add_paragraph("Текст")
    add_footnote(p, "Сноска")
    ref = p._p.find(f".//{qn('w:footnoteReference')}")
    run = ref.getparent()
    vert = run.find(f"{qn('w:rPr')}/{qn('w:vertAlign')}")
    assert vert is not None
    assert vert.get(qn("w:val")) == "superscript"


def test_reference_marker_size_is_10pt(doc):
    """Размер циферки-маркера в тексте = 10pt (val=20 half-points)."""
    p = doc.add_paragraph("Текст")
    add_footnote(p, "Сноска")
    ref = p._p.find(f".//{qn('w:footnoteReference')}")
    run = ref.getparent()
    sz = run.find(f"{qn('w:rPr')}/{qn('w:sz')}")
    assert sz is not None
    assert sz.get(qn("w:val")) == str(Sizes.footnote_pt * 2)


def test_footnote_text_size_is_10pt(doc):
    """Расшифровка сноски рендерится 10pt (val=20 half-points)."""
    p = doc.add_paragraph()
    add_footnote(p, "Расшифровка")
    footnotes_part = doc.part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
    sizes = footnotes_part._element.findall(f".//{qn('w:sz')}")
    vals = [s.get(qn("w:val")) for s in sizes]
    assert str(Sizes.footnote_pt * 2) in vals


def test_footnote_ref_in_part_is_superscript(doc):
    """Циферка в начале расшифровки также надстрочная."""
    p = doc.add_paragraph()
    add_footnote(p, "Расшифровка")
    footnotes_part = doc.part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
    ref = footnotes_part._element.find(f".//{qn('w:footnoteRef')}")
    run = ref.getparent()
    vert = run.find(f"{qn('w:rPr')}/{qn('w:vertAlign')}")
    assert vert is not None
    assert vert.get(qn("w:val")) == "superscript"
