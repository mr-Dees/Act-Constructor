"""TB-6: мягкий кламп font-size бэк-санитайзера к [min,max] из настроек.

После вырезания formatting-объекта (Task 5) серверная схема размер шрифта не
валидирует. Границу держат тулбар (фронт) и числовой пост-проход санитайзера
(_FontSizeClampFilter): легаси-контент/прямой API/внешняя вставка с размером
вне диапазона приводятся к границе, а не отвергаются. Дефолты границ — 8/72
(TextblocksSettings.font_size_min/max).
"""
from app.domains.acts.settings import ActsSettings, TextblocksSettings
from app.domains.acts.utils.html_sanitizer import sanitize_html


def test_font_size_above_max_clamped_to_max():
    out = sanitize_html('<span style="font-size: 99px">крупно</span>')
    assert "72px" in out
    assert "99px" not in out


def test_font_size_below_min_clamped_to_min():
    out = sanitize_html('<span style="font-size: 4px">мелко</span>')
    assert "8px" in out
    assert "4px" not in out


def test_font_size_in_range_untouched():
    """Валидный размер остаётся дословным (в т.ч. паритетные фикстуры 20px)."""
    out = sanitize_html('<span style="font-size: 20px">норма</span>')
    assert "20px" in out


def test_font_size_at_boundaries_untouched():
    for size in (8, 72):
        out = sanitize_html(f'<span style="font-size: {size}px">г</span>')
        assert f"{size}px" in out


def test_clamp_preserves_other_css_properties():
    """Кламп трогает только font-size — соседние свойства span остаются."""
    out = sanitize_html('<span style="font-size: 120px; color: red">т</span>')
    assert "72px" in out
    assert "120px" not in out
    assert "color" in out and "red" in out


def test_non_px_units_not_clamped():
    """em/%/pt редактор не эмитит — числовой кламп их не трогает."""
    for value in ("1.5em", "150%", "40pt"):
        out = sanitize_html(f'<span style="font-size: {value}">т</span>')
        assert value in out


def test_clamp_respects_settings_bounds(monkeypatch):
    """Границы берутся из настроек, не захардкожены: сузим диапазон до [10,24]."""
    import app.domains.acts.utils.html_sanitizer as mod

    narrow = ActsSettings(textblocks=TextblocksSettings(font_size_min=10, font_size_max=24))
    monkeypatch.setattr(mod, "_acts_settings", lambda: narrow)

    assert "24px" in sanitize_html('<span style="font-size: 72px">т</span>')
    assert "10px" in sanitize_html('<span style="font-size: 8px">т</span>')
    assert "18px" in sanitize_html('<span style="font-size: 18px">т</span>')


def test_multiple_spans_each_clamped():
    out = sanitize_html(
        '<span style="font-size: 200px">a</span>'
        '<span style="font-size: 2px">b</span>'
    )
    # Полные объявления, чтобы «2px» не совпадал как подстрока «72px».
    assert "font-size: 72px" in out
    assert "font-size: 8px" in out
    assert "font-size: 200px" not in out
    assert "font-size: 2px" not in out
