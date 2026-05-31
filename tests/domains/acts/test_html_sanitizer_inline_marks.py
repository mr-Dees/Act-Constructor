"""Санитайзер пропускает data-атрибуты сносок и ссылок.

Без них экспорт в DOCX не видит текст сноски / URL ссылки
(теряются при сохранении контента).
"""
from app.domains.acts.utils.html_sanitizer import sanitize_html


def test_footnote_data_attrs_survive():
    html = (
        '<span class="text-footnote" data-footnote-id="footnote_1" '
        'data-footnote-text="Источник: реестр">видимый</span>'
    )
    out = sanitize_html(html)
    assert "data-footnote-text" in out
    assert "Источник: реестр" in out
    assert "видимый" in out


def test_link_data_attrs_survive():
    html = (
        '<span class="text-link" data-link-id="link_1" '
        'data-link-url="https://example.com/">ссылка</span>'
    )
    out = sanitize_html(html)
    assert "data-link-url" in out
    assert "https://example.com/" in out


def test_script_still_stripped_with_data_attrs_allowed():
    """Расширение whitelist не должно ослабить защиту от script.

    bleach(strip=True) вырезает сам тег <script>, текстовый остаток между
    тегами сохраняется — это штатное поведение (важна вырезка тега)."""
    html = '<span data-footnote-text="x">ok</span><script>alert(1)</script>'
    out = sanitize_html(html)
    assert "<script" not in out
    assert "ok" in out
    assert 'data-footnote-text="x"' in out


def test_onclick_still_stripped():
    html = '<span data-link-url="https://a/" onclick="alert(1)">t</span>'
    out = sanitize_html(html)
    assert "onclick" not in out
