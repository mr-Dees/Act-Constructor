"""Эндпоинты для работы с актами."""

from pathlib import Path

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse

from app.core.config import Settings
from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService

router = APIRouter()

# Инициализация сервиса
act_service = ActService()
settings = Settings()


@router.post("/save", response_model=ActSaveResponse)
async def save_act(
        data: ActDataSchema,
        fmt: str = Query("txt", enum=["txt", "md", "docx"], description="Формат сохранения (txt, md или docx)")
):
    """
    Сохраняет структуру и данные акта в выбранном формате.

    Args:
        data: Валидированные данные акта
        fmt: Формат файла ('txt', 'md' или 'docx')

    Returns:
        Результат сохранения с путем к файлу

    Raises:
        HTTPException: При ошибке валидации или сохранения
    """
    try:
        return act_service.save_act(data.model_dump(), fmt=fmt)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка сохранения акта: {str(e)}")


@router.get("/download/{filename}")
async def download_act(filename: str):
    """
    Скачивает сохраненный файл акта.

    Args:
        filename: Имя файла для скачивания

    Returns:
        Файл для скачивания

    Raises:
        HTTPException: Если файл не найден
    """
    try:
        file_path = Path(settings.ACTS_STORAGE_PATH) / filename

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Файл не найден")

        # Определяем MIME type по расширению
        mime_types = {
            '.txt': 'text/plain',
            '.md': 'text/markdown',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }

        media_type = mime_types.get(file_path.suffix, 'application/octet-stream')

        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=filename
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при скачивании: {str(e)}")


@router.get("/history")
async def get_acts_history():
    """
    Возвращает список сохраненных актов.

    Returns:
        Словарь со списком файлов актов
    """
    try:
        acts = act_service.get_act_history()
        return {"acts": acts, "count": len(acts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка получения истории: {str(e)}")


@router.post("/generate", response_model=ActSaveResponse)
async def generate_act(
        data: ActDataSchema,
        fmt: str = Query("txt", enum=["txt", "md", "docx"], description="Формат сохранения")
):
    """
    Генерирует и сохраняет акт (алиас для save_act).

    Args:
        data: Валидированные данные акта
        fmt: Формат файла ('txt', 'md' или 'docx')

    Returns:
        Результат сохранения с путем к файлу

    Raises:
        HTTPException: При ошибке валидации или генерации
    """
    try:
        return act_service.save_act(data.model_dump(), fmt=fmt)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка генерации акта: {str(e)}")
