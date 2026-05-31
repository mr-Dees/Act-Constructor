"""<a href="..."> в inline-HTML → <w:hyperlink> с r:id + external relationship."""
from docx import Document
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html


def test_hyperlink_creates_w_hyperlink_element():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(para, 'См. <a href="https://cbr.ru/">сайт ЦБ РФ</a>.', base_size_pt=12.0)
    hyperlinks = para._p.findall(qn("w:hyperlink"))
    assert len(hyperlinks) == 1


def test_hyperlink_has_external_relationship():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(para, '<a href="https://example.com/">test</a>', base_size_pt=12.0)
    hyperlink = para._p.find(qn("w:hyperlink"))
    r_id = hyperlink.get(qn("r:id"))
    assert r_id
    rels = para.part.rels
    rel = rels[r_id]
    assert rel.target_ref == "https://example.com/"
    assert rel.reltype == RELATIONSHIP_TYPE.HYPERLINK
    assert rel.is_external


def test_hyperlink_contains_text_run():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(para, '<a href="https://a.b/">ссылка</a>', base_size_pt=12.0)
    hyperlink = para._p.find(qn("w:hyperlink"))
    runs = hyperlink.findall(qn("w:r"))
    assert len(runs) == 1
    texts = runs[0].findall(qn("w:t"))
    assert texts[0].text == "ссылка"


def test_text_around_hyperlink_remains_in_paragraph_runs():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'Регламент <a href="https://x/">текст</a> от 2024 г.',
        base_size_pt=12.0,
    )
    full_text = para.text
    assert "Регламент " in full_text
    assert "текст" in full_text
    assert " от 2024 г." in full_text


def test_hyperlink_with_no_href_is_rendered_as_plain_text():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(para, '<a>no href</a>', base_size_pt=12.0)
    assert para._p.find(qn("w:hyperlink")) is None
    assert "no href" in para.text


def test_bold_text_outside_hyperlink_still_works():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<b>Жирный</b> и <a href="https://x/">ссылка</a>',
        base_size_pt=12.0,
    )
    paragraph_runs = para._p.findall(qn("w:r"))
    bold_run_found = any(
        r.findall(qn("w:t")) and r.findall(qn("w:t"))[0].text == "Жирный"
        for r in paragraph_runs
    )
    assert bold_run_found
