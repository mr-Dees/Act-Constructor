"""
CI-тест: полнота маппинга CHECK_CONSTRAINT_MESSAGES.

Парсит все schema.sql (PG и GP), извлекает имена именованных CHECK
constraint'ов и сверяет с ключами CHECK_CONSTRAINT_MESSAGES.

Упадёт с понятным сообщением если:
- в миграции есть CONSTRAINT <name> CHECK, но ключа в маппинге нет
- в маппинге есть ключ, которого нет ни в одной миграции
"""

import re
from pathlib import Path

import pytest

from app.core.exceptions import CHECK_CONSTRAINT_MESSAGES
from app.db.adapters.base import DatabaseAdapter


def _collect_constraint_names() -> dict[str, list[str]]:
    """
    Возвращает dict: constraint_name -> [список схем, где встречается].

    Парсит все app/domains/*/migrations/*/schema.sql.
    Использует DatabaseAdapter._split_sql_statements для корректного
    разбора SQL (учитывает dollar-quoting, строки, комментарии).
    """
    base = Path(__file__).parent.parent / "app" / "domains"
    schema_files = list(base.glob("*/migrations/*/schema.sql"))

    found: dict[str, list[str]] = {}

    for schema_path in sorted(schema_files):
        content = schema_path.read_text(encoding="utf-8")
        statements = DatabaseAdapter._split_sql_statements(content)
        for stmt in statements:
            # Вырезаем однострочные комментарии перед поиском
            clean = re.sub(r"--[^\n]*", "", stmt)
            names = re.findall(
                r"\bCONSTRAINT\s+(\w+)\s+CHECK\b",
                clean,
                re.IGNORECASE,
            )
            for name in names:
                found.setdefault(name, []).append(str(schema_path))

    return found


def test_all_constraints_are_mapped():
    """
    Каждый именованный CHECK constraint из schema.sql должен иметь
    соответствующий ключ в CHECK_CONSTRAINT_MESSAGES.
    """
    all_constraints = _collect_constraint_names()
    mapped_keys = set(CHECK_CONSTRAINT_MESSAGES.keys())
    constraint_names = set(all_constraints.keys())

    missing = constraint_names - mapped_keys
    if missing:
        details = "\n".join(
            f"  {name} (в {', '.join(all_constraints[name])})"
            for name in sorted(missing)
        )
        pytest.fail(
            f"Следующие CHECK constraint'ы не имеют маппинга в CHECK_CONSTRAINT_MESSAGES "
            f"(app/core/exceptions.py):\n{details}\n\n"
            f"Добавьте для каждого человеческое сообщение. "
            f"См. docs/developer-guide.md «Как добавить CHECK constraint»."
        )


def test_no_orphan_keys_in_mapping():
    """
    Каждый ключ в CHECK_CONSTRAINT_MESSAGES должен соответствовать
    хотя бы одному CHECK constraint в schema.sql.

    Предотвращает «мёртвые» записи после удаления/переименования constraint'а.
    """
    all_constraints = _collect_constraint_names()
    mapped_keys = set(CHECK_CONSTRAINT_MESSAGES.keys())
    constraint_names = set(all_constraints.keys())

    orphans = mapped_keys - constraint_names
    if orphans:
        pytest.fail(
            f"Следующие ключи CHECK_CONSTRAINT_MESSAGES не имеют "
            f"соответствующего constraint'а ни в одной schema.sql:\n"
            + "\n".join(f"  {k}" for k in sorted(orphans))
            + "\n\nУдалите устаревшие записи или проверьте имена constraint'ов."
        )


def test_no_unnamed_checks_in_pg_schemas():
    """
    Все CHECK constraint'ы в PG-схемах должны иметь явное имя.

    Безымянные CHECK PG генерирует с именем <table>_<col>_check —
    это нестабильное имя (зависит от порядка объявления) и маппинг
    в CHECK_CONSTRAINT_MESSAGES по нему ненадёжен.
    """
    base = Path(__file__).parent.parent / "app" / "domains"
    pg_schemas = list(base.glob("*/migrations/postgresql/schema.sql"))

    violations = []
    for schema_path in sorted(pg_schemas):
        content = schema_path.read_text(encoding="utf-8")
        statements = DatabaseAdapter._split_sql_statements(content)
        for stmt in statements:
            clean = re.sub(r"--[^\n]*", "", stmt)
            # Найти все позиции CHECK (
            for m in re.finditer(r"\bCHECK\s*\(", clean, re.IGNORECASE):
                # Проверить, предшествует ли CONSTRAINT <name>
                prefix = clean[max(0, m.start() - 100) : m.start()]
                if not re.search(r"\bCONSTRAINT\s+\w+\s*$", prefix, re.IGNORECASE):
                    # Найти контекст для сообщения об ошибке
                    snippet = clean[max(0, m.start() - 60) : m.start() + 40].strip()
                    violations.append(f"{schema_path}: ...{snippet}...")

    if violations:
        pytest.fail(
            "Обнаружены безымянные CHECK constraint'ы в PG-схемах.\n"
            "Каждый CHECK должен иметь CONSTRAINT check_<table>_<purpose>:\n"
            + "\n".join(violations)
        )
