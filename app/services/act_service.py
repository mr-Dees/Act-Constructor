"""
Бизнес-логика работы с актами.

Координирует работу форматеров и сервиса хранения для
экспорта актов в различные форматы.
"""

from typing import Dict

from app.formatters.docx_formatter import DocxFormatter
from app.formatters.markdown_formatter import MarkdownFormatter
from app.formatters.text_formatter import TextFormatter
from app.schemas.act import ActSaveResponse
from app.services.storage_service import StorageService


class ActService:
    """
    Сервис для работы с актами.

    Предоставляет высокоуровневые методы для сохранения актов
    в разных форматах и получения истории документов.
    """

    def __init__(self):
        """Инициализация сервиса с форматерами и хранилищем."""
        # Инициализация форматеров для разных выходных форматов
        self.text_formatter = TextFormatter()
        self.markdown_formatter = MarkdownFormatter()
        self.docx_formatter = DocxFormatter()

        # Инициализация сервиса работы с файлами
        self.storage = StorageService()

    def save_act(self, data: Dict, fmt: str = "txt") -> ActSaveResponse:
        """
        Сохраняет акт в хранилище в выбранном формате.

        Процесс:
        1. Выбор форматера по типу формата
        2. Форматирование данных акта
        3. Сохранение через StorageService
        4. Возврат результата

        Args:
            data: Словарь с данными акта (дерево, таблицы, блоки)
            fmt: Формат файла ('txt', 'md' или 'docx')

        Returns:
            ActSaveResponse: Результат операции с именем файла

        Raises:
            ValueError: Если указан неподдерживаемый формат
        """
        filename = ""

        if fmt == "txt":
            # Экспорт в plain text
            formatted_text = self.text_formatter.format(data)
            filename = self.storage.save(
                formatted_text,
                prefix="act",
                extension="txt"
            )

        elif fmt == "md":
            # Экспорт в Markdown
            formatted_markdown = self.markdown_formatter.format(data)
            filename = self.storage.save(
                formatted_markdown,
                prefix="act",
                extension="md"
            )

        elif fmt == "docx":
            # Экспорт в Microsoft Word
            formatted_doc = self.docx_formatter.format(data)
            filename = self.storage.save_docx(formatted_doc, prefix="act")

        else:
            # Неподдерживаемый формат
            raise ValueError(
                f"Неподдерживаемый формат: {fmt}. "
                f"Используйте 'txt', 'md' или 'docx'."
            )

        # Формирование успешного ответа
        return ActSaveResponse(
            status="success",
            message=f"Акт успешно сохранён в формате {fmt.upper()}",
            filename=filename
        )
