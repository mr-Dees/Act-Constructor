"""Тесты регистрации рубрикатора через oxml."""
import pytest
from docx import Document
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.numbering import ensure_rubricator


def test_ensure_rubricator_returns_int_num_id(doc):
    num_id = ensure_rubricator(doc)
    assert isinstance(num_id, int)
    assert num_id >= 1


def test_ensure_rubricator_creates_abstract_num_with_9_levels(doc):
    """Один новый abstractNum добавляется, и он содержит ровно 9 уровней."""
    baseline = len(doc.part.numbering_part.element.findall(qn("w:abstractNum")))
    ensure_rubricator(doc)
    numbering_part = doc.part.numbering_part.element
    abstract = numbering_part.findall(qn("w:abstractNum"))
    # добавлен ровно один наш abstractNum
    assert len(abstract) == baseline + 1
    # наш — последний (append-стратегия)
    our_abstract = abstract[-1]
    levels = our_abstract.findall(qn("w:lvl"))
    assert len(levels) == 9


def test_abstract_num_uses_multilevel_not_hybrid(doc):
    """multiLevelType=multilevel; hybrid сбросил бы счёт уровня 0."""
    ensure_rubricator(doc)
    numbering_part = doc.part.numbering_part.element
    abstract = numbering_part.findall(qn("w:abstractNum"))[-1]
    mlt = abstract.find(qn("w:multiLevelType"))
    assert mlt.get(qn("w:val")) == "multilevel"


def test_level_text_format(doc):
    """lvl0=%1., lvl1=%1.%2., lvl2=%1.%2.%3., ..."""
    ensure_rubricator(doc)
    numbering_part = doc.part.numbering_part.element
    abstract = numbering_part.findall(qn("w:abstractNum"))[-1]
    levels = abstract.findall(qn("w:lvl"))
    expected = [f"{'.'.join(f'%{i + 1}' for i in range(n + 1))}." for n in range(9)]
    actual = [lvl.find(qn("w:lvlText")).get(qn("w:val")) for lvl in levels]
    assert actual == expected


def test_no_lvl_override(doc):
    """Никаких lvlOverride — счёт продолжается без сбросов."""
    ensure_rubricator(doc)
    num = doc.part.numbering_part.element.findall(qn("w:num"))[-1]
    assert num.find(qn("w:lvlOverride")) is None


def test_ensure_rubricator_idempotent(doc):
    """Повторный вызов возвращает тот же num_id, без дубликатов."""
    baseline = len(doc.part.numbering_part.element.findall(qn("w:abstractNum")))
    num_id1 = ensure_rubricator(doc)
    num_id2 = ensure_rubricator(doc)
    assert num_id1 == num_id2
    abstracts = doc.part.numbering_part.element.findall(qn("w:abstractNum"))
    # добавлен ровно один, повтор не плодит дубли
    assert len(abstracts) == baseline + 1


def test_num_format_decimal_on_all_levels(doc):
    ensure_rubricator(doc)
    abstract = doc.part.numbering_part.element.findall(qn("w:abstractNum"))[-1]
    for lvl in abstract.findall(qn("w:lvl")):
        fmt = lvl.find(qn("w:numFmt"))
        assert fmt.get(qn("w:val")) == "decimal"


def test_all_levels_flush_left(doc):
    """Эталон: все уровни прижаты к левому краю (left=0, firstLine=0, без hanging)."""
    ensure_rubricator(doc)
    abstract = doc.part.numbering_part.element.findall(qn("w:abstractNum"))[-1]
    levels = abstract.findall(qn("w:lvl"))
    for ilvl, lvl in enumerate(levels):
        ind = lvl.find(qn("w:pPr")).find(qn("w:ind"))
        assert ind is not None, f"w:ind отсутствует для ilvl={ilvl}"
        assert ind.get(qn("w:left")) == "0", f"left должен быть 0 для ilvl={ilvl}"
        assert ind.get(qn("w:firstLine")) == "0", f"firstLine должен быть 0 для ilvl={ilvl}"
        assert ind.get(qn("w:hanging")) is None, f"hanging не должен задаваться для ilvl={ilvl}"


def test_level_alignment_rubricator_right_items_left(doc):
    """ilvl=0 (рубрикатор) — номер вправо; ilvl>=1 (пункты) — влево."""
    ensure_rubricator(doc)
    abstract = doc.part.numbering_part.element.findall(qn("w:abstractNum"))[-1]
    for ilvl, lvl in enumerate(abstract.findall(qn("w:lvl"))):
        jc = lvl.find(qn("w:lvlJc"))
        assert jc is not None, f"lvlJc отсутствует для ilvl={ilvl}"
        expected = "right" if ilvl == 0 else "left"
        assert jc.get(qn("w:val")) == expected, f"ilvl={ilvl} ожидался {expected}"


def test_item_levels_have_space_suffix(doc):
    """Пункты (ilvl>=1): текст идёт сразу после номера (w:suff=space)."""
    ensure_rubricator(doc)
    abstract = doc.part.numbering_part.element.findall(qn("w:abstractNum"))[-1]
    levels = abstract.findall(qn("w:lvl"))
    # ilvl=0 — без suff (рубрикатор), ilvl>=1 — suff=space
    assert levels[0].find(qn("w:suff")) is None
    for ilvl, lvl in enumerate(levels[1:], start=1):
        suff = lvl.find(qn("w:suff"))
        assert suff is not None, f"suff отсутствует для ilvl={ilvl}"
        assert suff.get(qn("w:val")) == "space"


def test_apply_numbering_attaches_numpr(doc):
    from app.domains.acts.formatters.docx.numbering import apply_numbering
    num_id = ensure_rubricator(doc)
    p = doc.add_paragraph()
    apply_numbering(p, num_id, ilvl=1)
    num_pr = p._p.find(qn("w:pPr")).find(qn("w:numPr"))
    assert num_pr is not None
    assert num_pr.find(qn("w:ilvl")).get(qn("w:val")) == "1"
    assert num_pr.find(qn("w:numId")).get(qn("w:val")) == str(num_id)
