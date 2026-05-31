"""Регрессия: defaultSections содержит 6 разделов, 6-й — Process Mining."""
import re
from pathlib import Path


def test_default_sections_has_six():
    path = Path("static/js/shared/app-config.js")
    text = path.read_text(encoding="utf-8")
    match = re.search(r"defaultSections:\s*\[(.+?)\]", text, re.DOTALL)
    assert match, "defaultSections не найден"
    items = re.findall(r"id:\s*'(\d+)'", match.group(1))
    assert items == ["1", "2", "3", "4", "5", "6"]


def test_section_6_is_process_mining():
    path = Path("static/js/shared/app-config.js")
    text = path.read_text(encoding="utf-8")
    assert "Оценка процесса по результатам исследования методом Process Mining" in text
