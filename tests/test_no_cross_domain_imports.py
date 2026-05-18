"""
Lint-тест: запрещает прямые cross-domain импорты между доменами.

Правила:
  1. Файл в app/domains/<X>/ (кроме deps.py) не должен содержать:
       from app.domains.<Y>.* import ...
       где Y != X, КРОМЕ:
       - from app.domains.<Y>.interfaces import ... — разрешено (публичный контракт)

  2. deps.py — специальная точка сборки (wire). В нём разрешены конкретные
     реализации из чужих доменов (иначе некуда поместить wire-логику).
     НО: deps.py не должен вызывать get_domain_settings("<чужой_домен>", ...).

  3. Любой файл домена (включая deps.py) не должен вызывать:
       get_domain_settings("<чужой_домен>", ...)
     Чужой домен — инкапсулируй в .interfaces или передавай через deps.py аргументом.

Закрывает п. 1.2.1 (cross-domain imports) и 1.2.2 (магическая строка-имя домена соседа).
"""

import ast
import re
from pathlib import Path

import pytest

# Корень проекта — два уровня вверх от tests/
DOMAINS_ROOT = Path(__file__).parent.parent / "app" / "domains"

# Все файлы Python внутри доменов
DOMAIN_FILES = sorted(DOMAINS_ROOT.rglob("*.py"))

# Регулярка для get_domain_settings("admin", ...)
_SETTINGS_CALL_RE = re.compile(r'get_domain_settings\s*\(\s*["\'](\w+)["\']')


def _domain_of(path: Path) -> str:
    """Возвращает имя домена для файла (первая директория после app/domains/)."""
    relative = path.relative_to(DOMAINS_ROOT)
    return relative.parts[0]


def _is_deps_file(path: Path) -> bool:
    """deps.py — точка сборки зависимостей, для неё ослаблены правила импорта."""
    return path.name == "deps.py"


def _collect_violations() -> list[str]:
    """
    Обходит все файлы доменов, ищет нарушения правил изоляции.
    """
    violations: list[str] = []

    for filepath in DOMAIN_FILES:
        domain = _domain_of(filepath)
        source = filepath.read_text(encoding="utf-8")

        # --- AST-проверка импортов (только для не-deps файлов) ---
        if not _is_deps_file(filepath):
            try:
                tree = ast.parse(source, filename=str(filepath))
            except SyntaxError:
                continue

            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                module = node.module or ""
                if not module.startswith("app.domains."):
                    continue

                parts = module.split(".")
                # parts: ["app", "domains", "<domain>", ...]
                if len(parts) < 3:
                    continue
                other_domain = parts[2]
                if other_domain == domain:
                    continue  # импорт внутри своего домена — ок

                # Разрешён только from app.domains.<Y>.interfaces import ...
                if len(parts) >= 4 and parts[3] == "interfaces":
                    continue

                rel = filepath.relative_to(DOMAINS_ROOT.parent.parent)
                violations.append(
                    f"cross-domain import: {domain} → {'.'.join(parts[2:])} "
                    f"(используй {other_domain}.interfaces вместо этого) "
                    f"[{rel}:{node.lineno}]"
                )

        # --- Проверка get_domain_settings("<чужой_домен>", ...) — везде ---
        for match in _SETTINGS_CALL_RE.finditer(source):
            other_domain = match.group(1)
            if other_domain == domain:
                continue  # своё — ок
            line_no = source[: match.start()].count("\n") + 1
            rel = filepath.relative_to(DOMAINS_ROOT.parent.parent)
            violations.append(
                f"cross-domain settings: {domain} → get_domain_settings(\"{other_domain}\", ...) "
                f"(инкапсулируй в {other_domain}.interfaces или передавай через deps.py аргументом) "
                f"[{rel}:{line_no}]"
            )

    return violations


# Собираем нарушения один раз, параметризуем каждое как отдельный тест
_VIOLATIONS = _collect_violations()


@pytest.mark.parametrize(
    "violation",
    _VIOLATIONS if _VIOLATIONS else [None],
    ids=range(len(_VIOLATIONS)) if _VIOLATIONS else ["no_violations"],
)
def test_no_cross_domain_import(violation):
    """Каждое нарушение изоляции доменов — отдельный провальный тест."""
    if violation is None:
        # Нарушений нет — тест проходит
        return
    pytest.fail(violation)
