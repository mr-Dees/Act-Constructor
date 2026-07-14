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
    # #12: заголовок «Описание» убран — остаются только буллиты.
    assert "**Описание:**" not in out
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


# --- #9/Q1: нумерация всех кейсов, сброс на не-кейсе (паритет с DOCX/превью) ---


def _violation_with_items(items):
    return dict(
        _VIOLATION,
        descriptionList={"enabled": False, "items": []},
        additionalContent={"enabled": True, "items": items},
    )


def test_markdown_empty_first_case_shifts_next_to_case_2():
    """Пустой первый кейс занимает «Кейс 1», следующий непустой → «Кейс 2»."""
    v = _violation_with_items([
        {"type": "case", "content": ""},
        {"type": "case", "content": "Второй"},
    ])
    out = _md()._format_violation(v)
    assert "**Кейс 1:**" in out
    assert "**Кейс 2:** Второй" in out


def test_markdown_case_numbering_resets_after_non_case():
    """Не-кейс (freeText) сбрасывает нумерацию кейсов."""
    v = _violation_with_items([
        {"type": "case", "content": "A"},
        {"type": "freeText", "content": "текст"},
        {"type": "case", "content": "B"},
    ])
    out = _md()._format_violation(v)
    assert "**Кейс 1:** A" in out
    assert "**Кейс 1:** B" in out
    assert "**Кейс 2:**" not in out


# --- #14: обязательные Нарушено/Установлено выводят метку даже при пустом ---


def test_markdown_required_labels_shown_when_empty():
    v = dict(_VIOLATION, violated="", established="")
    out = _md()._format_violation(v)
    assert "**Нарушено:**" in out
    assert "**Установлено:**" in out


# --- #16: картинка встраивается markdown-разметкой, имя файла — в title ---


def test_markdown_image_embedded_with_filename_in_title():
    v = _violation_with_items([{
        "type": "image",
        "url": "data:image/png;base64,AAAA",
        "caption": "Подпись",
        "filename": "pic.png",
    }])
    out = _md()._format_violation(v)
    assert '![Подпись](data:image/png;base64,AAAA "pic.png")' in out


def test_markdown_image_empty_url_falls_back_to_filename():
    v = _violation_with_items([{
        "type": "image", "url": "", "caption": "", "filename": "draft.png",
    }])
    out = _md()._format_violation(v)
    assert "*draft.png*" in out
    assert "![" not in out
