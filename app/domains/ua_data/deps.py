"""
DI-зависимости домена ua_data.

Предоставляет get_dictionary_service для использования в FastAPI Depends
и в фабриках других доменов — оборачивает get_db() в async generator и
собирает DictionaryService поверх DictionaryRepository.
"""

from collections.abc import AsyncGenerator

from app.db.connection import get_db
from app.domains.ua_data.repositories.dictionary_repository import (
    DictionaryRepository,
)
from app.domains.ua_data.services.dictionary_service import DictionaryService


async def get_dictionary_service() -> AsyncGenerator[DictionaryService, None]:
    """Создаёт DictionaryService с подключением из пула."""
    async with get_db() as conn:
        repo = DictionaryRepository(conn)
        yield DictionaryService(repo=repo)
