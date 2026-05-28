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
    main = "Times New Roman"


class Sizes:
    """Размеры в pt (НЕ half-points)."""
    body_pt = 12
    label_pt = 11
    table_data_pt = 9
    table_header_pt = 9
    footnote_pt = 10
    title_pt = 14


class Margins:
    """Поля страницы в сантиметрах."""
    top_cm = 1.0
    bottom_cm = 1.5
    left_cm = 1.25
    right_cm = 1.0


class Spacing:
    line = 1.15
    before_pt = 0
    after_pt = 0


class Borders:
    table_default = {"sz": 4, "val": "single", "color": "000000"}
    cover_table_none = {"val": "nil"}
