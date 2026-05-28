"""_render_item рендерит «Территориальные банки: …» курсивом, когда node.tb непуст."""
from docx import Document

from app.domains.acts.formatters.docx.formatter import DocxFormatter
from app.domains.acts.formatters.docx.numbering import ensure_rubricator
from app.domains.acts.formatters.docx.styles import Sizes


def _make_doc_with_num():
    doc = Document()
    num_id = ensure_rubricator(doc)
    return doc, num_id


def test_tb_paragraph_appears_when_tb_non_empty():
    doc, num_id = _make_doc_with_num()
    fmt = DocxFormatter()
    node = {"id": "5.1.1", "label": "Превышения лимитов", "tb": ["СибБ", "СРБ"]}
    fmt._render_item(doc, node, num_id=num_id, ilvl=2)

    texts = [p.text for p in doc.paragraphs]
    assert any("Территориальные банки: СибБ, СРБ" in t for t in texts)


def test_tb_paragraph_absent_when_tb_missing():
    doc, num_id = _make_doc_with_num()
    fmt = DocxFormatter()
    fmt._render_item(doc, {"id": "5.1", "label": "Без ТБ"}, num_id=num_id, ilvl=1)
    texts = [p.text for p in doc.paragraphs]
    assert not any("Территориальные банки" in t for t in texts)


def test_tb_paragraph_absent_when_tb_empty_list():
    doc, num_id = _make_doc_with_num()
    fmt = DocxFormatter()
    fmt._render_item(doc, {"id": "5.1", "label": "Пустой tb", "tb": []}, num_id=num_id, ilvl=1)
    texts = [p.text for p in doc.paragraphs]
    assert not any("Территориальные банки" in t for t in texts)


def test_tb_run_is_italic_and_10pt():
    doc, num_id = _make_doc_with_num()
    fmt = DocxFormatter()
    fmt._render_item(doc, {"id": "5.1.1", "label": "X", "tb": ["МБ"]}, num_id=num_id, ilvl=2)

    target = next(
        p for p in doc.paragraphs
        if "Территориальные банки" in p.text
    )
    runs = target.runs
    assert all(r.italic for r in runs)
    assert all(r.font.size and r.font.size.pt == Sizes.tb_inline_pt for r in runs)
