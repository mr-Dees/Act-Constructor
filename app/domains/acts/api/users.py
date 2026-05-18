"""API поиска пользователей для формирования аудиторской группы."""

from fastapi import APIRouter, Depends

from app.domains.acts.deps import get_users_repository
from app.domains.acts.schemas.act_metadata import UserSearchResult
from app.domains.admin.interfaces import IUserDirectory

router = APIRouter()

MIN_SEARCH_LENGTH = 2


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = "",
    repo: IUserDirectory = Depends(get_users_repository),
):
    """Поиск пользователей в справочнике по ФИО или логину."""
    if len(q.strip()) < MIN_SEARCH_LENGTH:
        return []
    return await repo.search_users(q.strip())
