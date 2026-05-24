"""Тест-страж: запрет ``@pytest.mark.xfail`` без ``strict=True``.

Мотив: ``xfail(strict=False)`` (или просто ``xfail()``) проходит и когда тест
падает, и когда внезапно начинает проходить — регрессия не ловится. Команда
проекта приняла правило: либо ``strict=True`` (если внезапно проходит → ошибка),
либо чинить тест.

См. CLAUDE.md → раздел "Testing" → "``@pytest.mark.xfail(strict=False)`` запрещён".

Тест-страж сам себе исключение: regex написан так, чтобы не матчиться на
литералы внутри строки-комментария ниже.
"""
from __future__ import annotations

import re
from pathlib import Path


# Корень тестов — каталог с этим файлом.
_TESTS_ROOT = Path(__file__).resolve().parent

# Игнорируем самого себя при сканировании.
_SELF = Path(__file__).resolve()


def test_no_non_strict_xfail():
    """Сканирует tests/ на @pytest.mark.xfail без strict=True. Любой match — провал."""
    # Pattern: @pytest.mark.xfail( ... ) без явного strict=True внутри скобок.
    pattern = re.compile(
        r"@pytest\.mark\.xfail\((?![^)]*strict\s*=\s*True)",
    )

    offenders: list[str] = []
    for path in _TESTS_ROOT.rglob("test_*.py"):
        if path.resolve() == _SELF:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for match in pattern.finditer(text):
            line = text[: match.start()].count("\n") + 1
            offenders.append(f"{path.relative_to(_TESTS_ROOT)}:{line}")

    assert not offenders, (
        "Обнаружен @pytest.mark.xfail без strict=True: "
        f"{offenders}. Используй strict=True или почини тест."
    )
