"""span.text-footnote в inline-HTML → native Word footnote.

Фронт хранит сноску как
<span class="text-footnote" data-footnote-text="...">видимый текст</span>.
Экспорт должен отрендерить видимый текст обычным run'ом и добавить
нативную сноску Word с footnoteReference после него.
"""
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

from app.domains.acts.formatters.docx.builders.inline import apply_inline_html

_FOOTNOTES_REL = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
)


def test_footnote_span_renders_anchor_text():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'До <span class="text-footnote" data-footnote-text="Источник X">факта</span> и после.',
        base_size_pt=12.0,
    )
    assert "До " in para.text
    assert "факта" in para.text
    # BUG-5: пробел СРАЗУ после номера сноски — неразрывный (U+00A0), а не обычный.
    assert "\u00A0и после." in para.text


def test_footnote_followed_by_space_uses_nbsp():
    """BUG-5: обычный пробел-разделитель сразу ПОСЛЕ номера сноски экспортируется
    неразрывным (U+00A0) — под выравниванием «по ширине» (w:jc both) Word не
    растягивает NBSP, и номер не отрывается от последующего текста."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote" data-footnote-text="прим">слово</span> далее текст',
        base_size_pt=12.0,
    )
    assert "\u00A0далее" in para.text          # номер приклеен к «далее» неразрывно
    assert " далее" not in para.text           # обычного растяжимого пробела перед «далее» нет
    assert "далее текст" in para.text          # последующий обычный пробел сохранён

    # XML-уровень: текстовый run сразу за footnoteReference начинается с NBSP.
    runs = para._p.findall(qn("w:r"))
    ref_idx = next(
        i for i, r in enumerate(runs) if r.find(qn("w:footnoteReference")) is not None
    )
    next_text = runs[ref_idx + 1].find(qn("w:t")).text
    assert next_text.startswith("\u00A0")


def test_footnote_under_justify_glues_separator_before_anchor():
    """BUG-3: под выравниванием «по ширине» (w:jc both) разделитель между
    предыдущим словом и словом-якорем сноски — неразрывный (U+00A0). Иначе Word
    растягивает этот обычный пробел и блок «слово-якорь + номер» отрывается от
    предыдущего слова. Word растягивает только U+0020; U+00A0 не тянется."""
    doc = Document()
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    apply_inline_html(
        para,
        'текст <span class="text-footnote" data-footnote-text="прим">слово</span> хвост',
        base_size_pt=12.0,
    )
    assert "текст\u00A0слово" in para.text      # разделитель перед якорем неразрывный
    assert "текст слово" not in para.text         # обычного растяжимого пробела нет


def test_footnote_left_align_keeps_regular_separator_before_anchor():
    """BUG-3: вне justify разделитель перед якорём остаётся ОБЫЧНЫМ пробелом —
    неразрывный пробел там лишь ухудшил бы перенос строк без пользы."""
    doc = Document()
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    apply_inline_html(
        para,
        'текст <span class="text-footnote" data-footnote-text="прим">слово</span> хвост',
        base_size_pt=12.0,
    )
    assert "текст слово" in para.text              # обычный пробел-разделитель сохранён


def test_footnote_anchor_trailing_space_stripped_under_justify():
    """BUG-3: хвостовой обычный пробел ВНУТРИ якоря (например из вставки Word)
    срезается перед номером — иначе между якорем и номером осталась бы растяжимая
    щель под justify."""
    doc = Document()
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    apply_inline_html(
        para,
        'aaa <span class="text-footnote" data-footnote-text="прим">слово </span>bbb',
        base_size_pt=12.0,
    )
    runs = para._p.findall(qn("w:r"))
    ref_idx = next(
        i for i, r in enumerate(runs) if r.find(qn("w:footnoteReference")) is not None
    )
    anchor_text = runs[ref_idx - 1].find(qn("w:t")).text
    assert anchor_text == "слово"                 # хвостовой пробел якоря убран
    assert not anchor_text.endswith(" ")


def test_footnote_without_trailing_space_unaffected():
    """BUG-5: если после номера нет ведущего пробела — текст не трогаем."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote" data-footnote-text="прим">слово</span>, далее',
        base_size_pt=12.0,
    )
    assert "\u00A0" not in para.text  # ведущего пробела нет → NBSP не вставляем
    assert ", далее" in para.text


def test_footnote_span_creates_footnote_reference():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'Текст<span class="text-footnote" data-footnote-text="Примечание">якорь</span>.',
        base_size_pt=12.0,
    )
    refs = para._p.findall(f".//{qn('w:footnoteReference')}")
    assert len(refs) == 1


def test_footnote_span_text_lands_in_footnotes_part():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote" data-footnote-text="Уникальный текст QWE987">я</span>',
        base_size_pt=12.0,
    )
    footnotes_part = doc.part.part_related_by(_FOOTNOTES_REL)
    assert "QWE987".encode("utf-8") in footnotes_part.blob


def test_two_footnote_spans_get_increasing_ids():
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'a<span class="text-footnote" data-footnote-text="первая">x</span>'
        'b<span class="text-footnote" data-footnote-text="вторая">y</span>c',
        base_size_pt=12.0,
    )
    refs = para._p.findall(f".//{qn('w:footnoteReference')}")
    ids = [int(r.get(qn("w:id"))) for r in refs]
    assert ids == [1, 2]


def test_footnote_span_marker_uses_reference_style():
    """Циферка-маркер из inline-span оформлена стилем FootnoteReference."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        'Текст<span class="text-footnote" data-footnote-text="Примечание">я</span>.',
        base_size_pt=12.0,
    )
    ref = para._p.find(f".//{qn('w:footnoteReference')}")
    run = ref.getparent()
    rstyle = run.find(f"{qn('w:rPr')}/{qn('w:rStyle')}")
    assert rstyle is not None
    assert rstyle.get(qn("w:val")) == "FootnoteReference"


def test_footnote_span_without_text_renders_plain():
    """span.text-footnote без data-footnote-text — просто текст, без сноски."""
    doc = Document()
    para = doc.add_paragraph()
    apply_inline_html(
        para,
        '<span class="text-footnote">только якорь</span>',
        base_size_pt=12.0,
    )
    assert "только якорь" in para.text
    assert para._p.findall(f".//{qn('w:footnoteReference')}") == []
