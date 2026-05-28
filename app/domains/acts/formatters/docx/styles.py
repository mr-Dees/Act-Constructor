"""Стилевые константы для DOCX-экспорта актов.

Все значения нормализованы относительно эталона
(см. docs/superpowers/specs/etalon-recon.md, раздел «Аномалии»).
Палитра шапок таблиц сведена к одному цвету.
"""


class Palette:
    """Hex-цвета (без `#`) для shading и borders."""
    rubricator_shade = "DEEAF6"
    table_header_shade = "D9D9D9"
    table_border = "000000"
    body_text = "000000"


class Fonts:
    main = "Calibri"


class Sizes:
    """Все размеры в pt (не half-points). Под эталон — единый 12pt."""
    body_pt = 12
    label_pt = 12
    table_data_pt = 12
    table_header_pt = 12
    footnote_pt = 12
    title_pt = 12
    cover_label_pt = 12
    tb_inline_pt = 10  # «Территориальные банки: …» курсивом, чуть мельче


class Margins:
    """Поля страницы в сантиметрах под эталон."""
    top_cm = 1.0
    bottom_cm = 1.0
    left_cm = 1.5
    right_cm = 1.25


class Spacing:
    line = 1.15
    before_pt = 0
    after_pt = 0


class Borders:
    table_default = {"sz": 4, "val": "single", "color": "000000"}
    cover_table_none = {"val": "nil"}
