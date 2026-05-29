"""Проверка стилевых констант: Times New Roman, размеры под эталон, margins, defaults."""
from docx import Document
from docx.enum.text import WD_LINE_SPACING

from app.domains.acts.formatters.docx.styles import (
    Fonts,
    Margins,
    Sizes,
    Spacing,
    apply_document_defaults,
)


def test_main_font_is_times_new_roman():
    assert Fonts.main == "Times New Roman"


def test_body_sizes_are_12pt():
    assert Sizes.body_pt == 12
    assert Sizes.label_pt == 12
    assert Sizes.table_data_pt == 12
    assert Sizes.table_header_pt == 12
    assert Sizes.title_pt == 12
    assert Sizes.cover_label_pt == 12


def test_footnote_size_is_10pt():
    """Расшифровка сноски и циферка-ссылка под эталон — 10pt."""
    assert Sizes.footnote_pt == 10


def test_margins_match_etalon():
    assert Margins.top_cm == 1.0
    assert Margins.bottom_cm == 1.0
    assert Margins.left_cm == 1.5
    assert Margins.right_cm == 1.25


def test_spacing_single_line_3pt_after():
    assert Spacing.line_single == WD_LINE_SPACING.SINGLE
    assert Spacing.before_pt == 0
    assert Spacing.after_pt == 3


def test_apply_document_defaults_sets_normal_style():
    doc = Document()
    apply_document_defaults(doc)
    normal = doc.styles["Normal"]
    assert normal.font.name == "Times New Roman"
    assert normal.font.size.pt == 12
    pf = normal.paragraph_format
    assert pf.line_spacing_rule == WD_LINE_SPACING.SINGLE
    assert pf.space_after.pt == 3
    assert pf.space_before.pt == 0
