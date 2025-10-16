"""Базовый класс для форматеров."""

from abc import ABC, abstractmethod
from typing import Any


class BaseFormatter(ABC):
    """Абстрактный базовый класс для форматеров актов."""

    @abstractmethod
    def format(self, data: Any) -> str:
        """
        Форматирует данные в строковое представление.

        Args:
            data: Данные для форматирования

        Returns:
            Отформатированная строка
        """
        pass
