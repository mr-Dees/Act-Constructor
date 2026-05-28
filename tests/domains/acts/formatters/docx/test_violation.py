"""Тесты builder'а нарушений."""
from app.domains.acts.formatters.docx.numbering import ensure_rubricator
from app.domains.acts.formatters.docx.builders.violation import build_violation
from app.domains.acts.schemas.act_content import (
    ViolationSchema, ViolationOptionalFieldSchema,
)


def _v(**overrides):
    base = dict(
        id="v1", nodeId="5.1", violated="Текст нарушения",
        established="Текст установлено",
        reasons=ViolationOptionalFieldSchema(enabled=True, content="Причина-X"),
        consequences=ViolationOptionalFieldSchema(enabled=True, content="Последствие-Y"),
        responsible=ViolationOptionalFieldSchema(enabled=True, content="Иванов И.И."),
        recommendations=ViolationOptionalFieldSchema(
            enabled=True, content="Рекомендация-Z",
        ),
    )
    base.update(overrides)
    return ViolationSchema(**base)


def test_violation_renders_recommendations(doc):
    """Регрессия: recommendations раньше не рендерились."""
    num_id = ensure_rubricator(doc)
    build_violation(doc, _v(), num_id=num_id, ilvl=1, problem_number="П00001")
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Рекомендация-Z" in text
    assert "Рекомендации" in text


def test_violation_header_is_bold_and_numbered(doc):
    num_id = ensure_rubricator(doc)
    build_violation(doc, _v(), num_id=num_id, ilvl=1, problem_number="П00001")
    header = next(p for p in doc.paragraphs if "Проблема" in p.text)
    assert header.runs[0].bold is True
    from docx.oxml.ns import qn
    num_pr = header._p.find(qn("w:pPr")).find(qn("w:numPr"))
    assert num_pr is not None
    assert num_pr.find(qn("w:ilvl")).get(qn("w:val")) == "1"


def test_disabled_optional_fields_not_rendered(doc):
    num_id = ensure_rubricator(doc)
    violation = _v(
        reasons=ViolationOptionalFieldSchema(enabled=False, content="скрытая"),
    )
    build_violation(doc, violation, num_id=num_id, ilvl=1, problem_number="П00002")
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "скрытая" not in text


def test_labels_are_underlined(doc):
    num_id = ensure_rubricator(doc)
    build_violation(doc, _v(), num_id=num_id, ilvl=1, problem_number="П00003")
    label_runs = [
        r for p in doc.paragraphs for r in p.runs
        if r.text.strip() in {"Причины:", "Последствия:", "Ответственный:", "Рекомендации:"}
    ]
    assert len(label_runs) == 4
    assert all(r.underline for r in label_runs)
