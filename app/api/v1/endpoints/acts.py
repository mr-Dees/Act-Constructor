"""Эндпоинты для работы с актами."""

from fastapi import APIRouter

from app.schemas.act import ActDataSchema, ActSaveResponse
from app.services.act_service import ActService

router = APIRouter()

# Инициализация сервиса
act_service = ActService()


@router.post("/save", response_model=ActSaveResponse)
async def save_act(data: ActDataSchema):
    """
    Сохраняет структуру и данные акта.

    Args:
        data: Валидированные данные акта

    Returns:
        Результат сохранения с путем к файлу
    """
    return act_service.save_act(data.dict())


@router.get("/history")
async def get_acts_history():
    """
    Возвращает список сохраненных актов.

    Returns:
        Список файлов актов
    """
    acts = act_service.get_act_history()
    return {"acts": acts}
