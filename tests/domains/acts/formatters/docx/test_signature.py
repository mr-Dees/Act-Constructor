"""build_signature рендерит подпись «Руководитель аудиторской проверки [ФИО]»."""
from docx import Document

from app.domains.acts.formatters.docx.builders.signature import (
    _short_fio,
    build_signature,
)


class _Team:
    def __init__(self, role, full_name):
        self.role = role
        self.full_name = full_name


class _Meta:
    def __init__(self, team):
        self.audit_team = team


def test_short_fio_three_words():
    assert _short_fio("Иванов Иван Иванович") == "Иванов И.И."


def test_short_fio_two_words():
    assert _short_fio("Иванов Иван") == "Иванов И."


def test_short_fio_single_word():
    assert _short_fio("Иванов") == "Иванов"


def test_signature_contains_role_label():
    doc = Document()
    build_signature(doc, _Meta([_Team("Руководитель", "Иванов Иван Иванович")]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Руководитель аудиторской проверки" in full_text


def test_signature_contains_leader_short_fio():
    doc = Document()
    build_signature(doc, _Meta([
        _Team("Куратор", "Куратова Анна Андреевна"),
        _Team("Руководитель", "Иванов Иван Иванович"),
    ]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    # Выводится сокращённое ФИО, а не полное.
    assert "Иванов И.И." in full_text
    assert "Иванов Иван Иванович" not in full_text
    assert "Куратова" not in full_text


def test_signature_falls_back_when_no_leader():
    doc = Document()
    build_signature(doc, _Meta([_Team("Участник", "Петров Пётр Петрович")]))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    assert "Руководитель аудиторской проверки" in full_text
    assert "_" in full_text


def test_signature_inserts_blank_paragraph_for_air():
    doc = Document()
    before = len(doc.paragraphs)
    build_signature(doc, _Meta([_Team("Руководитель", "Иванов Иван Иванович")]))
    after = len(doc.paragraphs)
    assert after - before >= 2
