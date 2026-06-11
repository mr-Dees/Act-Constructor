"""Тест-фиксация семантики descriptionList в MD/TXT (M.3-хвост).

Семантика как в DOCX: ПОЛНЫЙ список пунктов (не сводка «N метрик»).
MD: «**Описание:**» + маркированный список; TXT: «Описание:» + «  • …».
Если кто-то «оптимизирует» вывод до счётчика — эти тесты укажут на дрейф.
"""
from app.domains.acts.formatters.markdown_formatter import MarkdownFormatter
from app.domains.acts.formatters.text_formatter import TextFormatter
from app.domains.acts.settings import ActsSettings


def _md() -> MarkdownFormatter:
    return MarkdownFormatter(settings=None, acts_settings=ActsSettings())


def _txt() -> TextFormatter:
    return TextFormatter(settings=None, acts_settings=ActsSettings())


_VIOLATION = {
    "violated": "Нарушено-X",
    "established": "Установлено-Y",
    "descriptionList": {
        "enabled": True,
        "items": ["Метрика один", "Метрика два", "Метрика три"],
    },
    "additionalContent": {"enabled": False, "items": []},
    "reasons": {"enabled": False, "content": ""},
    "consequences": {"enabled": False, "content": ""},
    "responsible": {"enabled": False, "content": ""},
    "recommendations": {"enabled": False, "content": ""},
}


def test_markdown_renders_full_description_list():
    out = _md()._format_violation(_VIOLATION)
    assert "**Описание:**" in out
    for item in _VIOLATION["descriptionList"]["items"]:
        assert f"- {item}" in out
    # Сводки-счётчика нет.
    assert "метрик" not in out


def test_text_renders_full_description_list():
    out = _txt()._format_violation(_VIOLATION)
    assert "Описание:" in out
    for item in _VIOLATION["descriptionList"]["items"]:
        assert f"• {item}" in out
    assert "метрик" not in out


def test_disabled_description_list_not_rendered():
    violation = dict(_VIOLATION, descriptionList={"enabled": False, "items": ["скрытая"]})
    assert "скрытая" not in _md()._format_violation(violation)
    assert "скрытая" not in _txt()._format_violation(violation)
