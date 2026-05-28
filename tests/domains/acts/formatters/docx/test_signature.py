"""build_signature рендерит подпись «Руководитель аудиторской проверки [ФИО]»."""
from docx import Document

from app.domains.acts.formatters.docx.builders.signature import build_signature


class _Team:
    def __init__(self, role, full_name):
        self.role = role
        self.full_name = full_name


class _Meta:
    def __init__(self, team):
        self.audit_team = team


def test_signature_contains_role_label():
    doc = Document()
    build_signature(doc, _Meta([_Team("Руководитель", "Б.Б. Иванов")]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Руководитель аудиторской проверки" in full_text


def test_signature_contains_leader_full_name():
    doc = Document()
    build_signature(doc, _Meta([
        _Team("Куратор", "А.А. Куратова"),
        _Team("Руководитель", "Б.Б. Иванов"),
    ]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Б.Б. Иванов" in full_text
    assert "А.А. Куратова" not in full_text


def test_signature_falls_back_when_no_leader():
    doc = Document()
    build_signature(doc, _Meta([_Team("Участник", "В.В. Петров")]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Руководитель аудиторской проверки" in full_text
    assert "_" in full_text


def test_signature_inserts_blank_paragraph_for_air():
    doc = Document()
    before = len(doc.paragraphs)
    build_signature(doc, _Meta([_Team("Руководитель", "Б.Б. Иванов")]))
    after = len(doc.paragraphs)
    assert after - before >= 2
