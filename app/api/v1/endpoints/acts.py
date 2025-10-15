"""Эндпоинты для работы с актами."""

from fastapi import APIRouter, Query, HTTPException

from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService

router = APIRouter()

# Инициализация сервиса
act_service = ActService()


@router.post("/save", response_model=ActSaveResponse)
async def save_act(
        data: ActDataSchema,
        fmt: str = Query("txt", enum=["txt", "docx"], description="Формат сохранения (txt или docx)")
):
    """
    Сохраняет структуру и данные акта в выбранном формате.

    Args:
        data: Валидированные данные акта
        fmt: Формат файла ('txt' или 'docx')

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
        fmt: str = Query("txt", enum=["txt", "docx"], description="Формат генерации (txt или docx)")
):
    """
    Генерирует и сохраняет акт (алиас для save_act).

    Args:
        data: Валидированные данные акта
        fmt: Формат файла ('txt' или 'docx')

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
