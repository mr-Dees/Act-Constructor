"""Пустые строки-распорки вокруг рубрикатора.

build_rubricator_plate сам распорок НЕ добавляет — их вставляет formatter
(пустая строка 6pt без интервалов до и после каждой плашки).
"""
from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx import DocxFormatter, ExportContext
from app.domains.acts.formatters.docx.builders.rubricator import build_rubricator_plate
from app.domains.acts.formatters.docx.numbering import ensure_rubricator
from app.domains.acts.schemas.act_content import ActDataSchema
from tests.domains.acts.formatters.docx.test_formatter_facade import _Meta


def test_plate_alone_adds_no_spacer_paragraph():
    """build_rubricator_plate создаёт только таблицу, без хвостового абзаца."""
    doc = Document()
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Раздел 1")
    assert doc.paragraphs == []
    assert len(doc.tables) == 1


def test_formatter_wraps_plates_with_blank_lines():
    """До и после каждой плашки — пустая строка 6pt без интервальных отступов."""
    fmt = DocxFormatter()
    sections = [{"id": "1", "label": "Раздел 1", "children": []}]
    content = ActDataSchema(tree={"id": "root", "label": "Акт", "children": sections})
    doc = fmt.format(ExportContext(metadata=_Meta(), content=content))

    blanks = []
    for p in doc.paragraphs:
        if p.text:
            continue
        r_pr = p._p.find(qn("w:pPr")).find(qn("w:rPr")) if p._p.find(qn("w:pPr")) is not None else None
        sz = r_pr.find(qn("w:sz")) if r_pr is not None else None
        if sz is not None and sz.get(qn("w:val")) == "12":  # 6pt
            assert p.paragraph_format.space_before.pt == 0
            assert p.paragraph_format.space_after.pt == 0
            blanks.append(p)
    # минимум две распорки на одну секцию (до и после плашки)
    assert len(blanks) >= 2
