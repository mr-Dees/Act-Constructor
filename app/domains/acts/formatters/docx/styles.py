"""Стилевые константы для DOCX-экспорта актов.

Все значения нормализованы относительно эталона
(docs/Эталонный акт.docx): шрифт Times New Roman, тело 12pt, сноски 10pt,
одинарный межстрочный интервал, 3pt после абзаца.
"""
from docx.document import Document
from docx.enum.text import WD_LINE_SPACING
from docx.shared import Pt


class Palette:
    """Hex-цвета (без `#`) для shading и borders."""
    rubricator_shade = "DEEAF6"
    table_header_shade = "D9D9D9"
    table_border = "000000"
    body_text = "000000"


class Fonts:
    main = "Times New Roman"


class Sizes:
    """Все размеры в pt (не half-points). Под эталон: тело 12pt, сноски 10pt."""
    body_pt = 12
    label_pt = 12
    table_data_pt = 12
    table_header_pt = 12
    footnote_pt = 10  # расшифровка сноски и циферка-ссылка под эталон
    title_pt = 12
    cover_label_pt = 12


class Margins:
    """Поля страницы в сантиметрах под эталон."""
    top_cm = 1.0
    bottom_cm = 1.0
    left_cm = 1.5
    right_cm = 1.25


class Spacing:
    """Межстрочный интервал и отступы абзацев под эталон.

    Эталон: одинарный интервал (line=240), 3pt после абзаца, 0 до.
    """
    line_single = WD_LINE_SPACING.SINGLE
    before_pt = 0
    after_pt = 3


class Borders:
    table_default = {"sz": 4, "val": "single", "color": "000000"}
    cover_table_none = {"val": "nil"}


def apply_document_defaults(doc: Document) -> None:  # type: ignore[name-defined]
    """Настраивает стиль Normal под эталон: TNR 12pt, одинарный интервал, 3pt после.

    Все абзацы документа наследуют Normal, поэтому единая правка стиля задаёт
    типографику всего акта без перебора билдеров.
    """
    normal = doc.styles["Normal"]
    normal.font.name = Fonts.main
    normal.font.size = Pt(Sizes.body_pt)

    pf = normal.paragraph_format
    pf.line_spacing_rule = Spacing.line_single
    pf.space_before = Pt(Spacing.before_pt)
    pf.space_after = Pt(Spacing.after_pt)
