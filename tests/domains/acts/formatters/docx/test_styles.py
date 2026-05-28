"""Тесты стилевых констант."""
from app.domains.acts.formatters.docx.styles import (
    Palette, Fonts, Sizes, Margins, Spacing, Borders,
)


def test_palette_has_rubricator_and_table_header():
    assert Palette.rubricator_shade == "DEEAF6"
    assert Palette.table_header_shade == "D9D9D9"
    assert Palette.table_border == "000000"


def test_fonts_main_is_times_new_roman():
    assert Fonts.main == "Times New Roman"


def test_sizes_body_is_12pt():
    assert Sizes.body_pt == 12
    assert Sizes.label_pt == 11
    assert Sizes.table_data_pt == 9
    assert Sizes.table_header_pt == 9
    assert Sizes.footnote_pt == 10
    assert Sizes.title_pt == 14


def test_margins_match_etalon():
    assert Margins.top_cm == 1.0
    assert Margins.bottom_cm == 1.5
    assert Margins.left_cm == 1.25
    assert Margins.right_cm == 1.0


def test_spacing_defaults():
    assert Spacing.line == 1.15
    assert Spacing.before_pt == 0
    assert Spacing.after_pt == 0


def test_borders_table_default_is_single_05pt():
    assert Borders.table_default == {"sz": 4, "val": "single", "color": "000000"}


def test_borders_cover_table_is_nil():
    assert Borders.cover_table_none == {"val": "nil"}
