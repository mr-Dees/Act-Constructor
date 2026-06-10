"""Тесты inline HTML → docx runs."""
from docx import Document
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html
from app.domains.acts.formatters.docx.styles import Fonts


def _add_p(doc):
    return doc.add_paragraph()


def test_plain_text(doc):
    p = _add_p(doc)
    apply_inline_html(p, "Просто текст.", base_size_pt=12)
    assert len(p.runs) == 1
    assert p.runs[0].text == "Просто текст."
    assert p.runs[0].font.name == Fonts.main
    assert p.runs[0].font.size == Pt(12)
    assert not p.runs[0].bold
    assert not p.runs[0].italic


def test_bold_tag(doc):
    p = _add_p(doc)
    apply_inline_html(p, "Слово <b>жирное</b> в строке", base_size_pt=12)
    texts = [(r.text, r.bold) for r in p.runs]
    assert texts == [("Слово ", False), ("жирное", True), (" в строке", False)]


def test_italic_and_underline(doc):
    p = _add_p(doc)
    apply_inline_html(p, "<i>курсив</i> и <u>подчёркнуто</u>", base_size_pt=12)
    assert p.runs[0].italic is True
    assert p.runs[2].underline is True


def test_font_size_px_converted_to_pt(doc):
    """16px в HTML должно стать 12pt (16 * 0.75)."""
    p = _add_p(doc)
    apply_inline_html(p, '<span style="font-size: 16px">шестнадцать</span>', base_size_pt=12)
    assert p.runs[0].font.size == Pt(12)


def test_font_size_pt_passed_through(doc):
    p = _add_p(doc)
    apply_inline_html(p, '<span style="font-size: 11pt">одиннадцать</span>', base_size_pt=12)
    assert p.runs[0].font.size == Pt(11)


def test_nested_bold_italic(doc):
    p = _add_p(doc)
    apply_inline_html(p, "<b><i>жирно-курсив</i></b>", base_size_pt=12)
    assert p.runs[0].bold is True
    assert p.runs[0].italic is True


def test_br_creates_line_break(doc):
    p = _add_p(doc)
    apply_inline_html(p, "первая<br/>вторая", base_size_pt=12)
    full_text = "".join(r.text for r in p.runs)
    assert "первая" in full_text and "вторая" in full_text


def test_br_void_no_slash(doc):
    """<br> без слэша должно вставить перевод строки (handle_starttag path)."""
    p = _add_p(doc)
    apply_inline_html(p, "первая<br>вторая", base_size_pt=12)
    full_text = "".join(r.text for r in p.runs)
    assert "первая" in full_text and "вторая" in full_text
    assert "\n" in full_text


def test_br_with_closing_tag_preserves_formatting(doc):
    """<b>text<br></br>more</b> — </br> не должен сорвать bold-фрейм."""
    p = _add_p(doc)
    apply_inline_html(p, "<b>один<br></br>два</b>", base_size_pt=12)
    # Все непустые runs внутри <b> должны быть bold
    bold_runs = [r for r in p.runs if r.text.strip()]
    assert len(bold_runs) >= 2
    assert all(r.bold for r in bold_runs)


def test_br_void_does_not_break_bold_balance(doc):
    """H7: void-<br> внутри <b> не ломает баланс стека.

    Раньше <br> пушил лишний кадр, </b> снимал его вместо bold-фрейма —
    и текст ПОСЛЕ </b> оставался жирным.
    """
    p = _add_p(doc)
    apply_inline_html(p, "<b>x<br>y</b> z", base_size_pt=12)
    runs = [(r.text, bool(r.bold)) for r in p.runs]
    # Текст внутри <b> жирный, перевод строки тоже внутри <b>
    assert ("x", True) in runs
    assert ("y", True) in runs
    # Текст после </b> НЕ жирный — баланс стека восстановлен
    assert (" z", False) in runs


def test_double_br_void_does_not_break_bold_balance(doc):
    """H7: два подряд void-<br> тоже не сдвигают баланс."""
    p = _add_p(doc)
    apply_inline_html(p, "<b>a<br><br>b</b> tail", base_size_pt=12)
    runs = [(r.text, bool(r.bold)) for r in p.runs]
    assert ("a", True) in runs
    assert ("b", True) in runs
    assert (" tail", False) in runs


def test_empty_html(doc):
    p = _add_p(doc)
    apply_inline_html(p, "", base_size_pt=12)
    assert len(p.runs) == 0
