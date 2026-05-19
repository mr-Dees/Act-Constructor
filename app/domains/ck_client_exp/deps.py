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


async def get_cs_validation_service() -> AsyncGenerator[CSValidationService, None]:
    """Создаёт CSValidationService с подключением из пула.

    DictionaryRepository разрешается через ``domain_registry.get_factory`` —
    cross-domain зависимость идёт через Protocol, без прямого импорта класса.
    """
    from app.core.domain_registry import get_factory

    async with get_db() as conn:
        cs_repo = CSValidationRepository(conn)
        dict_repo: IDictionaryRepository = get_factory(
            "ua_data.dictionary_repository"
        )(conn)
        yield CSValidationService(cs_repo=cs_repo, dict_repo=dict_repo)
