"""
Бизнес-логика работы с актами.

Координирует работу форматеров и сервиса хранения для
экспорта актов в различные форматы.
"""

import logging
from typing import Dict, Literal

from app.core.config import Settings
from app.formatters.docx_formatter import DocxFormatter
from app.formatters.markdown_formatter import MarkdownFormatter
from app.formatters.text_formatter import TextFormatter
from app.schemas.act import ActSaveResponse
from app.services.storage_service import StorageService

logger = logging.getLogger("act_constructor.service")


class ActService:
    """
    Сервис для работы с актами.

    Предоставляет высокоуровневые методы для сохранения актов
    в разных форматах и получения истории документов.
    """

    def __init__(self, storage: StorageService, settings: Settings):
        """
        Инициализация сервиса с форматерами и хранилищем.

        Args:
            storage: Сервис хранения файлов (dependency injection)
            settings: Настройки приложения (dependency injection)
        """
        self.storage = storage
        self.settings = settings

        # Кэшируем экземпляры форматеров (они stateless и thread-safe)
        self._formatters = {
            'txt': TextFormatter(settings),
            'md': MarkdownFormatter(settings),
            'docx': DocxFormatter(settings)
        }
        logger.debug("ActService инициализирован с кэшированными форматерами")

    def save_act(
            self,
            data: Dict,
            fmt: Literal["txt", "md", "docx"] = "txt"
    ) -> ActSaveResponse:
        """
        Сохраняет акт в хранилище в выбранном формате.

        Процесс:
        1. Выбор кэшированного форматера по типу формата
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
        if fmt not in self._formatters:
            raise ValueError(
                f"Неподдерживаемый формат: {fmt}. "
                f"Используйте 'txt', 'md' или 'docx'."
            )

        # Получаем кэшированный форматер
        formatter = self._formatters[fmt]
        extension = fmt

        logger.debug(f"Используется форматер: {formatter.__class__.__name__}")

        # Форматирование данных
        formatted_content = formatter.format(data)

        # Сохранение в зависимости от формата
        if fmt == "docx":
            # Для DOCX используем специальный метод
            filename = self.storage.save_docx(formatted_content, prefix="act")
        else:
            # Для текстовых форматов используем обычный метод
            filename = self.storage.save(
                formatted_content,
                prefix="act",
                extension=extension
            )

        # Формирование успешного ответа
        return ActSaveResponse(
            status="success",
            message=f"Акт успешно сохранён в формате {fmt.upper()}",
            filename=filename
        )
