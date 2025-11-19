"""
Бизнес-логика работы с актами.

Координирует работу форматеров и сервиса хранения для
экспорта актов в различные форматы.
"""

import asyncio
import gc
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from app.core.config import Settings
from app.formatters.docx_formatter import DocxFormatter
from app.formatters.markdown_formatter import MarkdownFormatter
from app.formatters.text_formatter import TextFormatter
from app.schemas.act import ActSaveResponse
from app.services.storage_service import StorageService

logger = logging.getLogger("act_constructor.service")

# ThreadPoolExecutor для CPU/IO-intensive операций.
# Размер пула = количество CPU cores для оптимальной загрузки.
executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="act_formatter")


class ActService:
    """
    Сервис для работы с актами.

    Предоставляет высокоуровневые методы для сохранения актов
    в разных форматах. Использует кэшированные форматеры и
    ThreadPoolExecutor для неблокирующих операций.
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

    def _format_sync(
            self,
            data: dict,
            fmt: Literal["txt", "md", "docx"]
    ):
        """
        Синхронная версия форматирования для выполнения в executor.

        Выполняется в отдельном потоке для предотвращения блокировки event loop.

        Args:
            data: Словарь с данными акта
            fmt: Формат файла

        Returns:
            Отформатированный контент
        """
        formatter = self._formatters[fmt]
        logger.debug(f"Форматирование в {fmt} (thread: {threading.current_thread().name})")
        return formatter.format(data)

    async def save_act(
            self,
            data: dict,
            fmt: Literal["txt", "md", "docx"] = "txt"
    ) -> ActSaveResponse:
        """
        Асинхронно сохраняет акт в хранилище в выбранном формате.

        Процесс:
        1. Выбор кэшированного форматера по типу формата
        2. Форматирование данных акта в отдельном потоке (не блокирует event loop)
        3. Сохранение через StorageService
        4. Очистка памяти
        5. Возврат результата

        Args:
            data: Словарь с данными акта (дерево, таблицы, блоки)
            fmt: Формат файла ('txt', 'md' или 'docx')

        Returns:
            Результат операции с именем файла

        Raises:
            ValueError: Если указан неподдерживаемый формат
        """
        if fmt not in self._formatters:
            raise ValueError(
                f"Неподдерживаемый формат: {fmt}. "
                f"Используйте 'txt', 'md' или 'docx'."
            )

        extension = fmt
        logger.debug(f"Используется форматер: {self._formatters[fmt].__class__.__name__}")

        try:
            # Форматирование в отдельном потоке для не блокирования event loop.
            loop = asyncio.get_event_loop()
            formatted_content = await loop.run_in_executor(
                executor,
                self._format_sync,
                data,
                fmt
            )

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
        finally:
            # Явная очистка памяти после обработки
            formatted_content = None
            gc.collect()
            logger.debug("Память очищена после сохранения акта")
