"""
Эндпоинты для работы с актами.

Предоставляет HTTP API для сохранения актов в различных форматах
и скачивания сохраненных файлов.
"""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import FileResponse

from app.core.config import get_settings, Settings
from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService
from app.services.storage_service import StorageService

logger = logging.getLogger("act_constructor.api")
router = APIRouter()

# Semaphore для ограничения одновременных операций с файлами
# Инициализируется при первом запросе
_file_semaphore = None


def get_file_semaphore(settings: Settings = Depends(get_settings)) -> asyncio.Semaphore:
    """
    Получает глобальный semaphore для ограничения файловых операций.

    Защищает от исчерпания file descriptors при большом количестве
    одновременных запросов на скачивание.
    """
    global _file_semaphore
    if _file_semaphore is None:
        _file_semaphore = asyncio.Semaphore(settings.max_concurrent_file_operations)
        logger.info(f"File semaphore инициализирован: {settings.max_concurrent_file_operations}")
    return _file_semaphore


def get_storage_service(settings: Settings = Depends(get_settings)) -> StorageService:
    """
    Dependency для получения StorageService.

    Создает новый экземпляр для каждого запроса (dependency injection).
    """
    return StorageService(storage_dir=settings.storage_dir)


def get_act_service(
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings)
) -> ActService:
    """Dependency для получения сервиса работы с актами."""
    return ActService(storage=storage, settings=settings)


@router.get("/health")
async def health_check() -> dict:
    """
    Health check endpoint для мониторинга.

    Returns:
        Статус сервиса и версия
    """
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_title,
        "version": settings.app_version
    }


@router.post("/save_act", response_model=ActSaveResponse)
async def save_act(
        data: ActDataSchema,
        fmt: Literal["txt", "md", "docx"] = Query(
            "txt",
            description="Формат сохранения файла"
        ),
        act_service: ActService = Depends(get_act_service)
) -> ActSaveResponse:
    """
    Сохраняет структуру акта в указанном формате.

    Args:
        data: Данные акта (дерево структуры, таблицы, текстовые блоки, нарушения)
        fmt: Формат экспорта - 'txt', 'md' или 'docx'
        act_service: Сервис для работы с актами (injected)

    Returns:
        Результат операции с именем сохраненного файла

    Raises:
        HTTPException: 400 при ошибке валидации, 500 при ошибке сохранения
    """
    try:
        logger.info(f"Запрос на сохранение акта в формате {fmt}")

        # Используем mode='python' для оптимизации
        # Конвертируем только необходимые поля без лишней сериализации
        data_dict = data.model_dump(mode='python')

        # Проверяем что пришло
        logger.debug(f"Получено таблиц: {len(data_dict.get('tables', {}))}")
        logger.debug(f"Получено текстовых блоков: {len(data_dict.get('textBlocks', {}))}")
        logger.debug(f"Получено нарушений: {len(data_dict.get('violations', {}))}")

        # Await для асинхронного метода
        result = await act_service.save_act(data_dict, fmt=fmt)
        logger.info(f"Акт успешно сохранен: {result.filename}")
        return result
    except ValueError as e:
        # Ошибка валидации формата
        logger.error(f"Ошибка валидации формата: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Неожиданная ошибка при сохранении
        logger.exception(f"Неожиданная ошибка при сохранении акта: {e}")
        # В production не показываем внутренние детали
        raise HTTPException(
            status_code=500,
            detail="Произошла ошибка при сохранении акта. Попробуйте позже."
        )


@router.get("/download/{filename}")
async def download_act(
        filename: str,
        storage: StorageService = Depends(get_storage_service),
        file_semaphore: asyncio.Semaphore = Depends(get_file_semaphore)
) -> FileResponse:
    """
    Скачивает сохраненный файл акта.

    Добавлена защита от исчерпания file descriptors
    через semaphore ограничивающий количество одновременных операций.

    Args:
        filename: Имя файла для скачивания
        storage: Сервис хранения (injected)
        file_semaphore: Semaphore для ограничения одновременных операций (injected)

    Returns:
        Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: 400 для небезопасных имен, 404 если файл не найден
    """
    # Используем semaphore для ограничения одновременных файловых операций
    async with file_semaphore:
        try:
            logger.info(f"Запрос на скачивание файла: {filename}")

            # Валидация и получение безопасного пути
            file_path = storage.get_file_path(filename)
            if file_path is None:
                is_valid = storage.validate_filename(filename)
                status_code = 400 if not is_valid else 404
                detail = "Некорректное имя файла" if not is_valid else "Файл не найден"
                logger.warning(f"Отказ в доступе к файлу: {filename} (код: {status_code})")
                raise HTTPException(status_code=status_code, detail=detail)

            # Определяем MIME-тип по расширению файла
            mime_types = {
                '.txt': 'text/plain',
                '.md': 'text/markdown',
                '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            }
            media_type = mime_types.get(
                file_path.suffix,
                'application/octet-stream'
            )

            logger.info(f"Файл {filename} отправлен на скачивание")

            # Возвращаем файл для скачивания
            return FileResponse(
                path=file_path,
                media_type=media_type,
                filename=filename
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Ошибка при скачивании файла {filename}: {e}")
            raise HTTPException(
                status_code=500,
                detail="Произошла ошибка при скачивании файла"
            )
