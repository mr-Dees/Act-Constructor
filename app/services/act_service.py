"""Бизнес-логика работы с актами."""

from typing import Dict

from app.formatters.docx_formatter import DocxFormatter
from app.formatters.markdown_formatter import MarkdownFormatter
from app.formatters.text_formatter import TextFormatter
from app.schemas.act import ActSaveResponse
from app.services.storage_service import StorageService


class ActService:
    """Сервис для работы с актами."""

    def __init__(self):
        """Инициализация сервиса актов."""
        self.text_formatter = TextFormatter()
        self.markdown_formatter = MarkdownFormatter()
        self.docx_formatter = DocxFormatter()
        self.storage = StorageService()

    def save_act(self, data: Dict, fmt: str = "txt") -> ActSaveResponse:
        """
        Сохраняет акт в хранилище в выбранном формате.

        Args:
            data: Данные акта
            fmt: Формат файла ('txt', 'md' или 'docx')

        Returns:
            Результат сохранения

        Raises:
            ValueError: Если указан неподдерживаемый формат
        """
        filename = ""

        if fmt == "txt":
            # Форматируем данные в текст
            formatted_text = self.text_formatter.format(data)
            # Сохраняем в файл
            filename = self.storage.save(formatted_text, prefix="act", extension="txt")

        elif fmt == "md":
            # Форматируем данные в Markdown
            formatted_markdown = self.markdown_formatter.format(data)
            # Сохраняем в файл
            filename = self.storage.save(formatted_markdown, prefix="act", extension="md")

        elif fmt == "docx":
            # Форматируем данные в документ DOCX
            formatted_doc = self.docx_formatter.format(data)
            # Сохраняем документ
            filename = self.storage.save_docx(formatted_doc, prefix="act")

        else:
            raise ValueError(f"Неподдерживаемый формат: {fmt}. Используйте 'txt', 'md' или 'docx'.")

        return ActSaveResponse(
            status="success",
            message=f"Акт успешно сохранён в формате {fmt.upper()}",
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
