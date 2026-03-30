"""
Бизнес-логика работы с актами.

Координирует работу форматеров и сервиса хранения для
экспорта актов в различные форматы.
"""

import asyncio
import gc
import logging
import threading
from typing import Literal

from app.core.config import Settings
from app.core.exceptions import AppError
from app.domains.acts.exceptions import UnsupportedFormatError
from app.domains.acts.formatters.docx_formatter import DocxFormatter
from app.domains.acts.formatters.markdown_formatter import MarkdownFormatter
from app.domains.acts.formatters.text_formatter import TextFormatter
from app.domains.acts.schemas.act_content import ActSaveResponse
from app.domains.acts.services.storage_service import StorageService
from app.domains.acts._lifecycle import get_executor
from app.domains.acts.settings import ActsSettings

logger = logging.getLogger("audit_workstation.service.acts.export")


class ExportService:
    """
    Сервис для работы с актами.

    Предоставляет высокоуровневые методы для сохранения актов
    в разных форматах. Использует кэшированные форматеры и
    ThreadPoolExecutor для неблокирующих операций.
    """

    def __init__(self, storage: StorageService, settings: Settings, acts_settings: ActsSettings):
        """
        Инициализация сервиса с форматерами и хранилищем.

        Args:
            storage: Сервис хранения файлов (dependency injection)
            settings: Настройки приложения (dependency injection)
            acts_settings: Доменные настройки актов (dependency injection)
        """
        self.storage = storage
        self.settings = settings

        # Кэшируем экземпляры форматеров (они stateless и thread-safe)
        self._formatters = {
            'txt': TextFormatter(settings, acts_settings),
            'md': MarkdownFormatter(settings, acts_settings),
            'docx': DocxFormatter(settings, acts_settings)
        }
        logger.debug("ExportService инициализирован с кэшированными форматерами")

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
            UnsupportedFormatError: Если указан неподдерживаемый формат
        """
        if fmt not in self._formatters:
            raise UnsupportedFormatError(
                f"Неподдерживаемый формат: {fmt}. "
                f"Используйте 'txt', 'md' или 'docx'."
            )

        extension = fmt
        logger.debug(f"Используется форматер: {self._formatters[fmt].__class__.__name__}")

        formatted_content = None
        try:
            # Форматирование в отдельном потоке для не блокирования event loop.
            loop = asyncio.get_running_loop()
            try:
                formatted_content = await loop.run_in_executor(
                    get_executor(),
                    self._format_sync,
                    data,
                    fmt
                )
            except AppError:
                raise
            except Exception as e:
                logger.exception(f"Ошибка форматирования акта в формат {fmt}: {e}")
                raise AppError(f"Не удалось отформатировать акт в формат {fmt.upper()}") from e

            # Сохранение в зависимости от формата
            try:
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
            except AppError:
                raise
            except Exception as e:
                logger.exception(f"Ошибка сохранения файла акта ({fmt}): {e}")
                raise AppError("Не удалось сохранить файл акта") from e

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
