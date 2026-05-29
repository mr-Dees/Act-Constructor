"""span.text-footnote в inline-HTML → native Word footnote.

Фронт хранит сноску как
<span class="text-footnote" data-footnote-text="...">видимый текст</span>.
Экспорт должен отрендерить видимый текст обычным run'ом и добавить
нативную сноску Word с footnoteReference после него.
"""
from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html

_FOOTNOTES_REL = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
)


def test_footnote_span_renders_anchor_text():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'До <span class="text-footnote" data-footnote-text="Источник X">факта</span> и после.',
        base_size_pt=12.0,
    )
    assert "До " in para.text
    assert "факта" in para.text
    assert " и после." in para.text


def test_footnote_span_creates_footnote_reference():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'Текст<span class="text-footnote" data-footnote-text="Примечание">якорь</span>.',
        base_size_pt=12.0,
    )
    refs = para._p.findall(f".//{qn('w:footnoteReference')}")
    assert len(refs) == 1


def test_footnote_span_text_lands_in_footnotes_part():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote" data-footnote-text="Уникальный текст QWE987">я</span>',
        base_size_pt=12.0,
    )
    footnotes_part = doc.part.part_related_by(_FOOTNOTES_REL)
    assert "QWE987".encode("utf-8") in footnotes_part.blob


def test_two_footnote_spans_get_increasing_ids():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'a<span class="text-footnote" data-footnote-text="первая">x</span>'
        'b<span class="text-footnote" data-footnote-text="вторая">y</span>c',
        base_size_pt=12.0,
    )
    refs = para._p.findall(f".//{qn('w:footnoteReference')}")
    ids = [int(r.get(qn("w:id"))) for r in refs]
    assert ids == [1, 2]


def test_footnote_span_without_text_renders_plain():
    """span.text-footnote без data-footnote-text — просто текст, без сноски."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote">только якорь</span>',
        base_size_pt=12.0,
    )
    assert "только якорь" in para.text
    assert para._p.findall(f".//{qn('w:footnoteReference')}") == []
