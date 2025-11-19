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

    Все форматеры должны реализовывать метод format(), который
    преобразует данные акта в целевой формат (txt, md, docx).
    """

    @abstractmethod
    def format(self, data: dict) -> Union[str, Document]:
        """
        Форматирует данные акта в целевое представление.

        Метод должен быть переопределен в наследуемых классах для
        реализации специфичной логики форматирования (текстовой,
        Markdown или DOCX).

        Args:
            data: Данные акта (tree, tables, textBlocks, violations)

        Returns:
            Отформатированный результат:
            - str для текстовых форматов (txt, md)
            - Document для бинарных форматов (docx)

        Raises:
            NotImplementedError: Если метод не переопределен в наследуемом классе
        """
        raise NotImplementedError("Наследуемый класс должен реализовать format()")
