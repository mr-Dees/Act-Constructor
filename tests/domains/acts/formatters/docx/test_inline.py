"""Тесты inline HTML → docx runs."""
from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html
from app.domains.acts.formatters.docx.styles import Fonts


def _add_p(doc):
    return doc.add_paragraph()


def _count_breaks(p) -> int:
    """Число реальных OOXML-переносов строки (<w:br/>) в параграфе."""
    return len(p._p.findall(".//" + qn("w:br")))


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
    """<br/> вставляет реальный OOXML-перенос (<w:br/>), а не символ '\\n'
    внутри <w:t>: литеральный '\\n' Word схлопывает в пробел (текст в одну
    строку при экспорте). _count_breaks считает именно элементы w:br —
    прежний баг (_add_run('\\n')) дал бы 0 переносов (python-docx показывает
    w:br как '\\n' в .text, поэтому различаем по XML, а не по тексту)."""
    p = _add_p(doc)
    apply_inline_html(p, "первая<br/>вторая", base_size_pt=12)
    full_text = "".join(r.text for r in p.runs)
    assert "первая" in full_text and "вторая" in full_text
    assert _count_breaks(p) == 1


def test_br_void_no_slash(doc):
    """<br> без слэша тоже вставляет OOXML-перенос (handle_starttag path)."""
    p = _add_p(doc)
    apply_inline_html(p, "первая<br>вторая", base_size_pt=12)
    full_text = "".join(r.text for r in p.runs)
    assert "первая" in full_text and "вторая" in full_text
    assert _count_breaks(p) == 1


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
    assert _count_breaks(p) == 2


def test_block_div_breaks_between_blocks(doc):
    """Enter в contenteditable → <div>: перенос МЕЖДУ блоками, не перед первым."""
    p = _add_p(doc)
    apply_inline_html(p, "<div>строка1</div><div>строка2</div>", base_size_pt=12)
    full_text = "".join(r.text for r in p.runs)
    assert "строка1" in full_text and "строка2" in full_text
    assert _count_breaks(p) == 1  # только между блоками


def test_block_div_no_leading_break(doc):
    """Одиночный <div>-wrapper вокруг содержимого не даёт ведущего переноса."""
    p = _add_p(doc)
    apply_inline_html(p, "<div>единственная</div>", base_size_pt=12)
    assert _count_breaks(p) == 0


def test_block_paragraph_tag_breaks(doc):
    """<p> трактуется как блок: перенос между абзацами."""
    p = _add_p(doc)
    apply_inline_html(p, "<p>раз</p><p>два</p>", base_size_pt=12)
    assert _count_breaks(p) == 1


def test_break_preserves_inline_formatting(doc):
    """Перенос не сбрасывает per-run начертание соседних runs."""
    p = _add_p(doc)
    apply_inline_html(p, "<b>жирн</b><br><i>курс</i>", base_size_pt=12)
    assert _count_breaks(p) == 1
    bold = next(r for r in p.runs if r.text == "жирн")
    italic = next(r for r in p.runs if r.text == "курс")
    assert bold.bold is True
    assert italic.italic is True


def test_break_preserves_font_size(doc):
    """Размер шрифта соседних с переносом runs сохраняется (20px → 15pt)."""
    p = _add_p(doc)
    apply_inline_html(p, '<span style="font-size:20px">A</span><br>B', base_size_pt=12)
    assert _count_breaks(p) == 1
    run_a = next(r for r in p.runs if r.text == "A")
    assert run_a.font.size == Pt(15)


def test_empty_html(doc):
    p = _add_p(doc)
    apply_inline_html(p, "", base_size_pt=12)
    assert len(p.runs) == 0


def test_strike_tags_render_strikethrough(doc):
    """M.19: <s>/<strike>/<del> → run.font.strike (тег-форма Chromium)."""
    for tag in ("s", "strike", "del"):
        p = _add_p(doc)
        apply_inline_html(p, f"до <{tag}>зачёркнуто</{tag}> после", base_size_pt=12)
        runs = [(r.text, bool(r.font.strike)) for r in p.runs]
        assert ("зачёркнуто", True) in runs, f"<{tag}> не дал зачёркивание"
        assert ("до ", False) in runs
        assert (" после", False) in runs


def test_strike_via_span_style_line_through(doc):
    """M.19: span style="text-decoration: line-through" → зачёркивание (CSS-форма)."""
    p = _add_p(doc)
    apply_inline_html(
        p,
        '<span style="text-decoration: line-through;">зач</span> обычный',
        base_size_pt=12,
    )
    runs = [(r.text, bool(r.font.strike)) for r in p.runs]
    assert ("зач", True) in runs
    assert (" обычный", False) in runs


def test_strike_via_span_style_text_decoration_line(doc):
    """M.19: вариант свойства text-decoration-line тоже распознаётся."""
    p = _add_p(doc)
    apply_inline_html(
        p,
        '<span style="text-decoration-line: line-through;">зач</span>',
        base_size_pt=12,
    )
    assert p.runs[0].font.strike is True


def test_strike_nested_with_bold(doc):
    """Зачёркивание комбинируется с другими начертаниями."""
    p = _add_p(doc)
    apply_inline_html(p, "<b><s>жирно-зачёркнуто</s></b>", base_size_pt=12)
    assert p.runs[0].bold is True
    assert p.runs[0].font.strike is True
