"""
Эндпоинты для работы с актами.

Предоставляет HTTP API для сохранения актов в различных форматах
и скачивания сохраненных файлов.
"""

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


def get_storage_service(settings: Settings = Depends(get_settings)) -> StorageService:
    """
    Dependency для получения StorageService.

    Создает новый экземпляр для каждого запроса (dependency injection).
    """
    return StorageService(storage_dir=settings.storage_dir)


def get_act_service(storage: StorageService = Depends(get_storage_service)) -> ActService:
    """Dependency для получения сервиса работы с актами."""
    return ActService(storage=storage)


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

        # ОТЛАДКА: проверяем что пришло
        data_dict = data.model_dump()
        logger.debug(f"Получено таблиц: {len(data_dict.get('tables', {}))}")
        logger.debug(f"Список ID таблиц: {list(data_dict.get('tables', {}).keys())}")

        # Конвертируем Pydantic модель в словарь и передаем в сервис
        result = act_service.save_act(data.model_dump(), fmt=fmt)
        logger.info(f"Акт успешно сохранен: {result.filename}")
        return result
    except ValueError as e:
        # Ошибка валидации формата
        logger.error(f"Ошибка валидации формата: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Неожиданная ошибка при сохранении
        logger.exception(f"Неожиданная ошибка при сохранении акта: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка сохранения акта: {str(e)}"
        )


@router.get("/download/{filename}")
async def download_act(
        filename: str,
        storage: StorageService = Depends(get_storage_service)
) -> FileResponse:
    """
    Скачивает сохраненный файл акта.

    Args:
        filename: Имя файла для скачивания
        storage: Сервис хранения (injected)

    Returns:
        Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: 400 для небезопасных имен, 404 если файл не найден
    """
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
            detail=f"Ошибка при скачивании: {str(e)}"
        )
