"""
DI-зависимости домена ЦК Фин.Рез.

Предоставляет get_fr_validation_service для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.db.connection import get_db
from app.domains.ck_fin_res.repositories.fr_validation_repository import (
    FRValidationRepository,
)
from app.domains.ck_fin_res.services.fr_validation_service import (
    FRValidationService,
)
from app.domains.ua_data.repositories.dictionary_repository import (
    DictionaryRepository,
)


async def get_fr_validation_service() -> AsyncGenerator[FRValidationService, None]:
    """Создаёт FRValidationService с подключением из пула."""
    async with get_db() as conn:
        fr_repo = FRValidationRepository(conn)
        dict_repo = DictionaryRepository(conn)
        yield FRValidationService(fr_repo=fr_repo, dict_repo=dict_repo)
