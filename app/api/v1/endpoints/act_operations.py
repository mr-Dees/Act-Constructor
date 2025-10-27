"""
Эндпоинты для работы с актами.

Предоставляет HTTP API для сохранения актов и скачивания файлов
"""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse

from app.core.config import Settings
from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService

# Создание роутера для операций с актами
router = APIRouter()

# Инициализация сервиса и настроек
act_service = ActService()
settings = Settings()


@router.post("/save_act", response_model=ActSaveResponse)
async def save_act(
        data: ActDataSchema,
        fmt: str = Query(
            "txt",
            enum=["txt", "md", "docx"],
            description="Формат сохранения файла"
        )
):
    """
    Сохраняет структуру акта в указанном формате.

    Принимает данные акта (дерево структуры, таблицы, текстовые блоки,
    нарушения) и экспортирует их в выбранный формат файла.

    Args:
        data: Валидированные данные акта согласно схеме ActDataSchema
        fmt: Формат экспорта ('txt', 'md' или 'docx')

    Returns:
        ActSaveResponse: Результат операции с именем файла

    Raises:
        HTTPException: При ошибке валидации (400) или сохранения (500)
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
async def download_act(filename: str):
    """
    Скачивает сохраненный файл акта.

    Args:
        filename: Имя файла для скачивания (без пути)

    Returns:
        FileResponse: Файл для скачивания с корректным MIME-типом

    Raises:
        HTTPException: Если файл не найден (404) или ошибка доступа (500)
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
    except HTTPException:
        # Пробрасываем HTTP исключения без изменений
        raise
    except Exception as e:
        # Обрабатываем непредвиденные ошибки
        raise HTTPException(
            status_code=500,
            detail=f"Ошибка при скачивании: {str(e)}"
        )
