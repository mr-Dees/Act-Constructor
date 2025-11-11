"""
Эндпоинты для работы с актами.

Предоставляет HTTP API для сохранения актов в различных форматах
и скачивания сохраненных файлов.
"""

from typing import Literal

from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import FileResponse

from app.core.config import Settings
from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService

# Создание роутера для операций с актами
router = APIRouter()


def get_settings() -> Settings:
    """Dependency для получения настроек приложения."""
    return Settings()


def get_act_service() -> ActService:
    """Dependency для получения сервиса работы с актами."""
    return ActService()


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
        # Конвертируем Pydantic модель в словарь и передаем в сервис
        return act_service.save_act(data.model_dump(), fmt=fmt)
    except ValueError as e:
        # Ошибка валидации формата
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        # Неожиданная ошибка при сохранении
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка сохранения акта: {str(e)}"
        )


@router.get("/download/{filename}")
async def download_act(
        filename: str,
        settings: Settings = Depends(get_settings)
) -> FileResponse:
    """
    Скачивает сохраненный файл акта.

    Args:
        filename: Имя файла для скачивания
        settings: Настройки приложения (injected)

    Returns:
        Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: 404 если файл не найден, 500 при ошибке доступа
    """
    try:
        # Формируем полный путь к файлу
        file_path = settings.storage_dir / filename

        # Проверяем существование файла
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Файл не найден")

        # Определяем MIME-тип по расширению файла
        mime_types = {
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
        media_type = mime_types.get(
            file_path.suffix,
            # Дефолтный тип для неизвестных
            'application/octet-stream'
        )

        # Возвращаем файл для скачивания
        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=filename
        )
    except Exception as e:
        # Обрабатываем непредвиденные ошибки
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка при скачивании: {str(e)}"
        )
