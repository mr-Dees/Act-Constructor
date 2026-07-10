"""TB-1: per-tag политика style бэк-санитайзера (зеркало фронтового хука).

Кнопки justify* редактора пишут text-align в style блочных элементов
content. Политика (решение лида, вариант «а»): блочным тегам (div/p) в style
остаётся ТОЛЬКО text-align со строгим enum-значением (left/center/right/
justify) — пост-фильтр _BlockStyleFilter; span сохраняет полный CSS-allowlist
(SanitizerSettings; зеркала: _FALLBACK_CSS и ACTS_CSS_PROPERTIES фронта).
Политика зеркалит фактический контракт редактора: font-size живёт на span
(Range-хирургия), text-align — на блоках; div-level font-size отрисовало бы
превью, но DOCX его игнорирует — был бы шов превью↔экспорт.
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


def test_block_style_reduced_to_text_align_only():
    """Эталонный кейс политики: чужие (даже allowlist-ные для span) свойства
    на блочном теге срезаются, остаётся один text-align."""
    out = sanitize_html('<div style="font-size:40px; color:red; text-align:center">т</div>')
    assert out == '<div style="text-align: center">т</div>'


def test_block_style_without_text_align_dropped_entirely():
    """Блочный style без text-align (color и т.п.) снимается целиком."""
    out = sanitize_html('<div style="color: red;">т</div>')
    assert "style" not in out
    assert "red" not in out


def test_text_align_non_enum_values_stripped():
    """Мусорные значения (inherit/start/-webkit-*) режут style целиком —
    в DOCX они всё равно не выражаются (дефолт justify)."""
    for value in ("inherit", "start", "-webkit-center", "left-x"):
        out = sanitize_html(f'<div style="text-align: {value};">т</div>')
        assert "text-align" not in out, f"значение {value} прошло"
        assert "style" not in out


def test_p_same_block_policy_as_div():
    out = sanitize_html('<p style="text-align: right; font-weight: bold;">п</p>')
    assert out == '<p style="text-align: right">п</p>'


def test_span_full_css_allowlist_unchanged():
    """span — прежний полный allowlist: font-size/color живут (контракт
    редактора: размер и цвет эмитятся именно на span)."""
    out = sanitize_html('<span style="font-size: 20px; color: red;">с</span>')
    assert "font-size" in out
    assert "color" in out


def test_disallowed_css_still_stripped_from_div_style():
    """Разрешение style на div не открывает произвольный CSS: чужие
    свойства (position/z-index/url(...)) по-прежнему режутся."""
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
