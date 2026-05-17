"""
DI-зависимости домена ЦК Клиентский опыт.

Предоставляет get_cs_validation_service для использования в FastAPI Depends,
оборачивая get_db() (asynccontextmanager) в async generator.
"""

from collections.abc import AsyncGenerator

from app.db.connection import get_db
from app.domains.ck_client_exp.repositories.cs_validation_repository import (
    CSValidationRepository,
)
from app.domains.ck_client_exp.services.cs_validation_service import (
    CSValidationService,
)
from app.domains.ua_data.interfaces import IDictionaryRepository
from app.domains.ua_data.repositories.dictionary_repository import (
    DictionaryRepository,
)


async def get_cs_validation_service() -> AsyncGenerator[CSValidationService, None]:
    """Создаёт CSValidationService с подключением из пула."""
    async with get_db() as conn:
        cs_repo = CSValidationRepository(conn)
        dict_repo: IDictionaryRepository = DictionaryRepository(conn)
        yield CSValidationService(cs_repo=cs_repo, dict_repo=dict_repo)
