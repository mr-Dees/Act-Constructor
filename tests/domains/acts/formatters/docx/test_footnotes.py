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


def test_reference_marker_uses_footnote_reference_style(doc):
    """Циферка-маркер в тексте абзаца оформлена стилем FootnoteReference.

    Надстрочность даёт символьный стиль (как в эталоне), а не inline-vertAlign.
    """
    p = doc.add_paragraph("Текст")
    add_footnote(p, "Сноска")
    ref = p._p.find(f".//{qn('w:footnoteReference')}")
    run = ref.getparent()
    rstyle = run.find(f"{qn('w:rPr')}/{qn('w:rStyle')}")
    assert rstyle is not None
    assert rstyle.get(qn("w:val")) == "FootnoteReference"
    # inline-vertAlign на самой циферке не дублируется
    assert run.find(f"{qn('w:rPr')}/{qn('w:vertAlign')}") is None


def test_footnote_text_size_is_9pt(doc):
    """Расшифровка сноски рендерится 9pt (val=18 half-points)."""
    p = doc.add_paragraph()
    add_footnote(p, "Расшифровка")
    footnotes_part = doc.part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
    sizes = footnotes_part._element.findall(f".//{qn('w:sz')}")
    vals = [s.get(qn("w:val")) for s in sizes]
    assert str(Sizes.footnote_pt * 2) in vals


def test_footnote_ref_in_part_uses_reference_style(doc):
    """Циферка в начале расшифровки оформлена стилем FootnoteReference."""
    p = doc.add_paragraph()
    add_footnote(p, "Расшифровка")
    footnotes_part = doc.part.part_related_by(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
    )
    ref = footnotes_part._element.find(f".//{qn('w:footnoteRef')}")
    run = ref.getparent()
    rstyle = run.find(f"{qn('w:rPr')}/{qn('w:rStyle')}")
    assert rstyle is not None
    assert rstyle.get(qn("w:val")) == "FootnoteReference"
