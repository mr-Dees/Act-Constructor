"""
Базовый абстрактный класс для всех форматеров.

Определяет единый интерфейс для форматирования актов.
"""

from abc import ABC, abstractmethod
from typing import Union

from docx import Document


class BaseFormatter(ABC):
    """
    Абстрактный базовый класс для форматеров актов.

    Все форматеры должны реализовывать метод format().
    """

    @abstractmethod
    def format(self, data: dict) -> Union[str, Document]:
        """
        Форматирует данные акта в целевое представление.

        Args:
            data: Данные акта (tree, tables, textBlocks, violations)

        Returns:
            Union[str, Document]: Отформатированный результат
            - str для текстовых форматов (txt, md)
            - Document для бинарных форматов (docx)

        Raises:
            NotImplementedError: Если метод не переопределен
        """
        raise NotImplementedError("Наследуемый класс должен реализовать format()")
