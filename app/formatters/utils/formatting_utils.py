"""
Утилиты для работы с метаданными форматирования.

Обрабатывает параметры fontSize, alignment и создает их описания.
"""


class FormattingUtils:
    """Stateless класс-утилита для работы с форматированием."""

    # Константы по умолчанию
    DEFAULT_FONT_SIZE = 14
    DEFAULT_ALIGNMENT = "left"

    @classmethod
    def build_meta_description(cls, formatting: dict) -> list[str]:
        """
        Создает человекочитаемое описание параметров форматирования.

        Args:
            formatting: Словарь с параметрами {fontSize, alignment}

        Returns:
            Список строк-описаний (только отличающихся от дефолта)
        """
        meta: list[str] = []

        font_size = formatting.get("fontSize", cls.DEFAULT_FONT_SIZE)
        alignment = formatting.get("alignment", cls.DEFAULT_ALIGNMENT)

        # Добавляем только если отличается от дефолта
        if font_size != cls.DEFAULT_FONT_SIZE:
            meta.append(f"размер шрифта: {font_size}px")

        # Описание выравнивания
        alignment_labels = {
            "center": "по центру",
            "right": "по правому краю",
            "justify": "по ширине",
        }

        if alignment in alignment_labels:
            meta.append(f"выравнивание: {alignment_labels[alignment]}")

        return meta

    @staticmethod
    def get_alignment_value(alignment: str, default: str = "left") -> str:
        """
        Нормализует значение выравнивания.

        Args:
            alignment: Значение выравнивания
            default: Значение по умолчанию

        Returns:
            Нормализованное значение (left, center, right, justify)
        """
        valid_alignments = {"left", "center", "right", "justify"}
        return alignment if alignment in valid_alignments else default
