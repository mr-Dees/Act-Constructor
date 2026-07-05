"""TB-1: text-align переживает бэк-санитайзер на блочных тегах.

Кнопки justify* редактора пишут text-align в style блочных элементов
content. Раньше bleach разрешал style только на span — выравнивание
пропадало на PUT (центр исчезал после reload). Теперь style разрешён на
div/p, а text-align — в allowlist CSS-свойств (единый источник —
SanitizerSettings, зеркала: _FALLBACK_CSS и ACTS_CSS_PROPERTIES фронта).
"""
from app.domains.acts.utils.html_sanitizer import sanitize_html


def test_text_align_on_div_survives():
    out = sanitize_html('<div style="text-align: center;">центр</div>')
    assert "text-align" in out
    assert "center" in out


def test_text_align_on_p_survives():
    out = sanitize_html('<p style="text-align: right;">право</p>')
    assert "text-align" in out
    assert "right" in out


def test_all_alignment_values_survive():
    for value in ("left", "center", "right", "justify"):
        out = sanitize_html(f'<div style="text-align: {value};">т</div>')
        assert "text-align" in out and value in out, f"значение {value} срезано"


def test_disallowed_css_still_stripped_from_div_style():
    """Разрешение style на div не открывает произвольный CSS: чужие
    свойства (position/z-index/url(...)) CSSSanitizer по-прежнему режет."""
    out = sanitize_html(
        '<div style="text-align: center; position: fixed; '
        'background-image: url(https://evil/x)">т</div>'
    )
    assert "text-align" in out
    assert "position" not in out
    assert "url(" not in out


def test_event_handlers_still_stripped_from_div():
    out = sanitize_html('<div style="text-align: left" onclick="alert(1)">т</div>')
    assert "onclick" not in out
    assert "text-align" in out
