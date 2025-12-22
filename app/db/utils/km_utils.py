"""
Утилиты для работы с КМ-номерами и служебными записками.
"""

import re
from typing import Optional


class KMUtils:
    """Stateless утилиты для обработки КМ и служебных записок."""

    @staticmethod
    def extract_km_digits(km_number: str) -> str:
        """
        Извлекает только цифры из КМ номера.

        Ожидается ровно 7 цифр.

        Args:
            km_number: КМ в формате КМ-XX-XXXXX или произвольная строка.

        Returns:
            Строка из 7 цифр.

        Raises:
            ValueError: если количество цифр не равно 7.
        """
        digits = re.sub(r"[^0-9]", "", km_number)

        if len(digits) != 7:
            raise ValueError(
                f"КМ номер должен содержать ровно 7 цифр, получено: "
                f"{len(digits)} ({km_number})"
            )

        return digits

    @staticmethod
    def extract_service_note_suffix(service_note: str) -> Optional[str]:
        """
        Извлекает суффикс после "/" из служебной записки.

        Ожидается строка вида "Текст/XXXX".

        Args:
            service_note: Служебная записка.

        Returns:
            Строка после "/" или None, если разделитель не найден.
        """
        if not service_note:
            return None

        parts = service_note.rsplit("/", 1)
        if len(parts) == 2:
            return parts[1]
        return None
