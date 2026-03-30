"""Утилиты для безопасной работы с SQL-идентификаторами."""

import re

_IDENTIFIER_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')


def validate_sql_identifier(name: str) -> bool:
    """Проверяет что строка является безопасным SQL-идентификатором."""
    return bool(_IDENTIFIER_RE.match(name))


def quote_ident(name: str) -> str:
    """
    Возвращает безопасно экранированный SQL-идентификатор.

    Raises:
        ValueError: Если имя не является безопасным идентификатором
    """
    if not validate_sql_identifier(name):
        raise ValueError(f"Небезопасный SQL-идентификатор: {name!r}")
    return f'"{name}"'
