"""
Утилиты для работы с JSON/JSONB полями в слое БД.
"""

import json
from typing import Any


class JSONDBUtils:
    """Stateless утилита для JSON/JSONB из PostgreSQL."""

    @staticmethod
    def ensure_dict(value: Any) -> dict | None:
        """
        Гарантирует, что значение приведено к dict, если это JSON/JSONB.

        Поддерживает:
        - dict -> dict
        - str  -> json.loads(str) или None при ошибке
        - None/прочее -> None
        """
        if value is None:
            return None

        if isinstance(value, dict):
            return value

        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return None

        return None
