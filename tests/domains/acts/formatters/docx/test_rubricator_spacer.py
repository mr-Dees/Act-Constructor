"""После build_rubricator_plate должен добавляться пустой параграф с space_after=1pt."""
from docx import Document
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.rubricator import build_rubricator_plate
from app.domains.acts.formatters.docx.numbering import ensure_rubricator


def test_spacer_paragraph_inserted_after_plate():
    doc = Document()
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Раздел 1")

    paragraphs = doc.paragraphs
    assert len(paragraphs) >= 1
    spacer = paragraphs[-1]
    assert spacer.text == ""
    assert spacer.paragraph_format.space_after == Pt(1)
    assert spacer.paragraph_format.space_before == Pt(0)


def test_two_plates_produce_two_spacers():
    doc = Document()
    num_id = ensure_rubricator(doc)
    build_rubricator_plate(doc, num_id, "Раздел 1")
    build_rubricator_plate(doc, num_id, "Раздел 2")

    spacers = [p for p in doc.paragraphs if p.paragraph_format.space_after == Pt(1)]
    assert len(spacers) == 2
