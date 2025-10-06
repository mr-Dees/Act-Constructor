"""Бизнес-логика работы с актами."""

from typing import Dict
from app.formatters.text_formatter import TextFormatter
from app.services.storage_service import StorageService
from app.schemas.act import ActSaveResponse


class ActService:
    """Сервис для работы с актами."""

    def __init__(self):
        """Инициализация сервиса актов."""
        self.formatter = TextFormatter()
        self.storage = StorageService()

    def save_act(self, data: Dict) -> ActSaveResponse:
        """
        Сохраняет акт в хранилище.

        Args:
            data: Данные акта

        Returns:
            Результат сохранения
        """
        # Форматируем данные в текст
        formatted_text = self.formatter.format(data)

        # Сохраняем в файл
        filename = self.storage.save(formatted_text, prefix="act")

        return ActSaveResponse(
            status="success",
            message="Акт успешно сохранён",
            filename=filename
        )

    def get_act_history(self) -> list[str]:
        """
        Возвращает список сохраненных актов.

        Returns:
            Список имен файлов актов
        """
        acts = self.storage.get_all_acts()
        return [act.name for act in acts]
