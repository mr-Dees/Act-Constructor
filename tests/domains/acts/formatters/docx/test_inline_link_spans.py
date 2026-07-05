"""span.text-link в inline-HTML → w:hyperlink с external relationship.

Фронт хранит ссылку как
<span class="text-link" data-link-url="https://...">видимый текст</span>.
"""
from docx import Document
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html


def test_link_span_creates_hyperlink():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'См. <span class="text-link" data-link-url="https://cbr.ru/">сайт</span>.',
        base_size_pt=12.0,
    )
    hyperlinks = para._p.findall(qn("w:hyperlink"))
    assert len(hyperlinks) == 1


def test_link_span_has_external_relationship():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="https://example.com/">t</span>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    rel = para.part.rels[hyperlink.get(qn("r:id"))]
    assert rel.target_ref == "https://example.com/"
    assert rel.reltype == RELATIONSHIP_TYPE.HYPERLINK
    assert rel.is_external


def test_link_span_contains_visible_text():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="https://a.b/">ссылка</span>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    texts = hyperlink.find(qn("w:r")).findall(qn("w:t"))
    assert texts[0].text == "ссылка"


def test_javascript_url_is_not_a_hyperlink():
    """data-link-url с javascript:-схемой не должен стать гиперссылкой."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="javascript:alert(1)">клик</span>',
        base_size_pt=12.0,
    )
    assert para._p.find(qn("w:hyperlink")) is None
    assert "клик" in para.text


def test_a_tag_javascript_url_is_not_a_hyperlink():
    """Тот же protocol-guard защищает и <a href>."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<a href="javascript:alert(1)">клик</a>',
        base_size_pt=12.0,
    )
    assert para._p.find(qn("w:hyperlink")) is None
    assert "клик" in para.text


def test_data_url_is_not_a_hyperlink():
    """BUG-4: data: тоже остаётся вне гиперссылок (вектор эксфильтрации)."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="data:text/html,x">клик</span>',
        base_size_pt=12.0,
    )
    assert para._p.find(qn("w:hyperlink")) is None
    assert "клик" in para.text


def test_file_url_creates_external_hyperlink():
    """BUG-4: ссылка на локальный файл (file:) экспортируется как внешняя."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="file:///C:/doc.pdf">файл</span>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    assert hyperlink is not None
    rel = para.part.rels[hyperlink.get(qn("r:id"))]
    assert rel.target_ref == "file:///C:/doc.pdf"
    assert rel.is_external


def test_tel_url_creates_external_hyperlink():
    """BUG-4: tel: распознаётся как ссылка."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<a href="tel:+74951234567">позвонить</a>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    assert hyperlink is not None
    assert para.part.rels[hyperlink.get(qn("r:id"))].is_external


def test_link_span_font_size_applies_to_run():
    """EXP-1: капсула-ссылка со своим font-size экспортирует текст этим кеглем.
    Run внутри w:hyperlink строится прямым oxml → размер лежит в w:sz = кегль×2
    (20px → 15pt → val 30). Раньше ссылка игнорировала свой font-size."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" style="font-size: 20px" '
        'data-link-url="https://a.b/">крупно</span>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    sz = hyperlink.find(qn("w:r")).find(qn("w:rPr")).find(qn("w:sz"))
    assert sz.get(qn("w:val")) == "30"


def test_link_span_without_size_uses_base():
    """EXP-1-регресс: ссылка без собственного font-size экспортируется базовым
    кеглем (base_size_pt=12 → w:sz val 24), а не сбрасывается в дефолт 12pt×2."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="https://a.b/">обычная</span>',
        base_size_pt=13.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    sz = hyperlink.find(qn("w:r")).find(qn("w:rPr")).find(qn("w:sz"))
    assert sz.get(qn("w:val")) == "26"


def test_anchor_url_creates_internal_hyperlink():
    """BUG-4: якорь '#...' → внутренняя ссылка (w:anchor), без external r:id."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-link" data-link-url="#bookmark1">к разделу</span>',
        base_size_pt=12.0,
    )
    hyperlink = para._p.find(qn("w:hyperlink"))
    assert hyperlink is not None
    assert hyperlink.get(qn("w:anchor")) == "bookmark1"
    assert hyperlink.get(qn("r:id")) is None
    assert "к разделу" in para.text
