"""Тесты builder'а нарушений."""
from docx.oxml.ns import qn

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
    build_violation(doc, _v())
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Рекомендация-Z" in text
    assert "Рекомендации" in text


def test_violation_renders_required_fields(doc):
    """Поля «Нарушено:»/«Установлено:» присутствуют."""
    build_violation(doc, _v())
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "Нарушено:" in text
    assert "Текст нарушения" in text
    assert "Установлено:" in text
    assert "Текст установлено" in text


def test_violation_has_no_header_paragraph(doc):
    """Нет абзаца, начинающегося со слова «Проблема»."""
    build_violation(doc, _v())
    assert not any(p.text.strip().startswith("Проблема") for p in doc.paragraphs)


def test_violation_has_no_numbering(doc):
    """Ни в одном абзаце нарушения нет numPr."""
    build_violation(doc, _v())
    for p in doc.paragraphs:
        p_pr = p._p.find(qn("w:pPr"))
        if p_pr is None:
            continue
        assert p_pr.find(qn("w:numPr")) is None


def test_disabled_optional_fields_not_rendered(doc):
    violation = _v(
        reasons=ViolationOptionalFieldSchema(enabled=False, content="скрытая"),
    )
    build_violation(doc, violation)
    text = "\n".join(p.text for p in doc.paragraphs)
    assert "скрытая" not in text


def test_labels_are_underlined(doc):
    build_violation(doc, _v())
    label_runs = [
        r for p in doc.paragraphs for r in p.runs
        if r.text.strip() in {"Причины:", "Последствия:", "Ответственный:", "Рекомендации:"}
    ]
    assert len(label_runs) == 4
    assert all(r.underline for r in label_runs)
