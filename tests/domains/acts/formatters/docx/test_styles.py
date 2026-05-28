"""Проверка стилевых констант: Calibri, 12pt везде, margins под эталон."""
from app.domains.acts.formatters.docx.styles import Fonts, Margins, Sizes


def test_main_font_is_calibri():
    assert Fonts.main == "Calibri"


def test_all_sizes_are_12pt():
    assert Sizes.body_pt == 12
    assert Sizes.label_pt == 12
    assert Sizes.table_data_pt == 12
    assert Sizes.table_header_pt == 12
    assert Sizes.footnote_pt == 12
    assert Sizes.title_pt == 12
    assert Sizes.cover_label_pt == 12


def test_tb_inline_size_is_10pt():
    assert Sizes.tb_inline_pt == 10


def test_margins_match_etalon():
    assert Margins.top_cm == 1.0
    assert Margins.bottom_cm == 1.0
    assert Margins.left_cm == 1.5
    assert Margins.right_cm == 1.25
