"""Тест-страж вынесенного в violation_render.py общего рендеринга (#12 code review).

markdown_formatter/text_formatter отличались только токенами оформления
(жирный текст, буллит) в _add_required_pair/_add_labeled_section/
_add_description_list/_add_case. Эти тесты фиксируют, что shared-функции
корректно применяют MD- и TXT-токены — независимо от парити-тестов на
уровне форматтеров (test_md_txt_violation_parity.py, test_violation_parity.py).
"""
from app.domains.acts.formatters.violation_render import (
    add_case,
    add_description_list,
    add_labeled_section,
    add_required_pair,
    wrap_bold,
    wrap_plain,
)


def test_wrap_bold_wraps_in_markdown_bold():
    assert wrap_bold("Нарушено:") == "**Нарушено:**"


def test_wrap_plain_is_identity():
    assert wrap_plain("Нарушено:") == "Нарушено:"


def test_add_required_pair_md_token():
    lines = []
    add_required_pair(lines, "Нарушено", "текст", wrap_bold)
    assert lines[0] == "**Нарушено:** текст"


def test_add_required_pair_txt_token():
    lines = []
    add_required_pair(lines, "Нарушено", "текст", wrap_plain)
    assert lines[0] == "Нарушено: текст"


def test_add_labeled_section_md_token():
    lines = []
    add_labeled_section(lines, "Причины", {"enabled": True, "content": "текст"}, wrap_bold)
    assert lines[0] == "**Причины:** текст"


def test_add_labeled_section_txt_token():
    lines = []
    add_labeled_section(lines, "Причины", {"enabled": True, "content": "текст"}, wrap_plain)
    assert lines[0] == "Причины: текст"


def test_add_description_list_md_bullet():
    lines = []
    add_description_list(lines, {"enabled": True, "items": ["A"]}, "- ")
    assert lines[0] == "- A"


def test_add_description_list_txt_bullet():
    lines = []
    add_description_list(lines, {"enabled": True, "items": ["A"]}, "  • ")
    assert lines[0] == "  • A"


def test_add_case_md_token():
    lines = []
    next_number = add_case(lines, {"content": "текст"}, 1, wrap_bold)
    assert lines[0] == "**Кейс 1:** текст"
    assert next_number == 2


def test_add_case_txt_token():
    lines = []
    next_number = add_case(lines, {"content": "текст"}, 1, wrap_plain)
    assert lines[0] == "Кейс 1: текст"
    assert next_number == 2
