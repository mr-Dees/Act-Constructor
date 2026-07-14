"""Эндпоинты text-actions.

Пока один: ``POST /chat/text-actions/correct`` — корректор орфографии и
пунктуации выделенного текста (Фича «Корректор»).
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
    """Исправить орфографию/пунктуацию выделенного текста."""
    corrected = await service.correct(body.text)
    return CorrectResponse(corrected_text=corrected)
