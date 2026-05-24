"""API поиска пользователей для формирования аудиторской группы."""

from fastapi import APIRouter, Depends

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import get_users_repository
from app.domains.acts.schemas.act_metadata import UserSearchResult
from app.domains.admin.interfaces import IUserDirectory

router = APIRouter()

MIN_SEARCH_LENGTH = 2


@router.get("/users/search", response_model=list[UserSearchResult])
async def search_users(
    q: str = "",
    username: str = Depends(get_username),
    repo: IUserDirectory = Depends(get_users_repository),
):
    """Поиск пользователей в справочнике по ФИО или логину.

    Требует аутентификации — справочник содержит ФИО и должности всех
    сотрудников и не должен быть доступен анонимно.
    """
    if len(q.strip()) < MIN_SEARCH_LENGTH:
        return []
    return await repo.search_users(q.strip())
