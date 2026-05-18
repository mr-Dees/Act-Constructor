"""
Утилиты для работы с JSON/JSONB полями из базы данных.

Обрабатывает типичные случаи данных, приходящих из PostgreSQL:
- None
- dict
- JSON-строка
"""

import json
from typing import Any


class JSONUtils:
    """Stateless класс-утилита для работы с JSON данными."""

    @staticmethod
    def parse_db_json_field(field: Any) -> dict | None:
        """
        Парсит JSON/JSONB поле из БД.

        Обрабатывает три случая:
        - None -> None
        - dict -> возвращает как есть
        - str -> пытается распарсить JSON

        Args:
            field: JSON/JSONB поле (Python-объект или строка)

        Returns:
            Распарсенный dict или None
        """
        if field is None:
            return None

        if isinstance(field, dict):
            return field

        if isinstance(field, str):
            try:
                return json.loads(field)
            except json.JSONDecodeError:
                return None

        return None
