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


def get_storage_service(settings: Settings = Depends(get_settings)) -> StorageService:
    """Создает экземпляр StorageService для dependency injection."""
    return StorageService(storage_dir=settings.storage_dir)


def get_act_service(
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings)
) -> ActService:
    """Создает экземпляр ActService для dependency injection."""
    return ActService(storage=storage, settings=settings)


@router.get("/health")
async def health_check() -> dict:
    """Проверяет работоспособность сервиса для мониторинга."""
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
        act_service: ActService = Depends(get_act_service),
        settings: Settings = Depends(get_settings)
) -> ActSaveResponse:
    """
    Сохраняет структуру акта в указанном формате.

    Args:
        data: Данные акта (дерево структуры, таблицы, текстовые блоки,
            нарушения)
        fmt: Формат экспорта - 'txt', 'md' или 'docx'
        act_service: Сервис для работы с актами (injected)
        settings: Настройки приложения (injected)

    Returns:
        Результат операции с именем сохраненного файла

    Raises:
        HTTPException: При ошибках валидации (400), timeout (408) или ошибке сохранения (500)
    """
    try:
        logger.info(f"Запрос на сохранение акта в формате {fmt}")

        # Валидация глубины дерева (защита от рекурсии)
        tree_depth = _calculate_tree_depth(data.tree)
        if tree_depth > settings.max_tree_depth:
            logger.warning(f"Превышена максимальная глубина дерева: {tree_depth}")
            raise HTTPException(
                status_code=400,
                detail=f"Глубина дерева ({tree_depth}) превышает максимум ({settings.max_tree_depth})"
            )

        # Используем mode='python' для оптимизации.
        # Конвертируем только необходимые поля без лишней сериализации.
        data_dict = data.model_dump(mode='python')

        # Проверяем что пришло
        logger.debug(f"Получено таблиц: {len(data_dict.get('tables', {}))}")
        logger.debug(f"Получено текстовых блоков: {len(data_dict.get('textBlocks', {}))}")
        logger.debug(f"Получено нарушений: {len(data_dict.get('violations', {}))}")
        logger.debug(f"Глубина дерева: {tree_depth}")

        # Добавлен timeout для всей операции
        try:
            result = await asyncio.wait_for(
                act_service.save_act(data_dict, fmt=fmt),
                timeout=settings.save_act_timeout
            )
        except asyncio.TimeoutError:
            logger.error(f"Timeout при сохранении акта (>{settings.save_act_timeout}s)")
            raise HTTPException(
                status_code=408,
                detail=f"Обработка акта заняла слишком много времени "
                       f"(>{settings.save_act_timeout}s). Попробуйте упростить структуру."
            )

        logger.info(f"Акт успешно сохранен: {result.filename}")
        return result

    except HTTPException:
        raise
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


def _calculate_tree_depth(tree: dict, current_depth: int = 0) -> int:
    """
    Рекурсивно вычисляет максимальную глубину дерева.

    Args:
        tree: Узел дерева с полем 'children'
        current_depth: Текущая глубина (для рекурсии)

    Returns:
        Максимальная глубина дерева
    """
    children = tree.get('children', [])
    if not children:
        return current_depth

    max_child_depth = current_depth
    for child in children:
        child_depth = _calculate_tree_depth(child, current_depth + 1)
        max_child_depth = max(max_child_depth, child_depth)

    return max_child_depth


@router.get("/download/{filename}")
async def download_act(
        filename: str,
        storage: StorageService = Depends(get_storage_service),
        settings: Settings = Depends(get_settings)
) -> FileResponse:
    """
    Скачивает сохраненный файл акта.

    Использует per-worker semaphore для ограничения одновременных
    файловых операций.

    Args:
        filename: Имя файла для скачивания
        storage: Сервис хранения (injected)
        settings: Настройки приложения (injected)

    Returns:
        Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: Для небезопасных имен (400) или если файл не найден (404)
    """
    # Создаем per-worker semaphore для ограничения файловых операций.
    # В multiprocessing каждый worker имеет свой event loop и свой
    # semaphore.
    if not hasattr(download_act, '_semaphore'):
        download_act._semaphore = asyncio.Semaphore(settings.max_concurrent_file_operations)
        logger.info(f"File semaphore создан для worker: {settings.max_concurrent_file_operations}")

    async with download_act._semaphore:
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
