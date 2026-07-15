"""Эндпоинты text-actions.

``POST /chat/text-actions/correct`` — обработка выделенного текста (Фича
«Корректор») в одном из режимов: ``fix`` (орфография/пунктуация) или
``readability`` (улучшение читаемости/структуры).
"""

from fastapi import APIRouter, Depends

from app.api.v1.deps.role_deps import require_domain_access
from app.domains.chat.deps import get_text_corrector_service
from app.domains.chat.schemas.text_actions import CorrectRequest, CorrectResponse

router = APIRouter(
    prefix="/text-actions",
    dependencies=[Depends(require_domain_access("chat"))],
)


@router.post("/correct", response_model=CorrectResponse)
async def correct_text(
    body: CorrectRequest,
    service=Depends(get_text_corrector_service),
) -> CorrectResponse:
    """Обработать выделенный текст: орфография/пунктуация (``fix``) или
    улучшение читаемости/структуры (``readability``)."""
    corrected = await service.correct(body.text, body.mode)
    return CorrectResponse(corrected_text=corrected)
