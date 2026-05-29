"""API поиска пользователей для формирования аудиторской группы."""

from fastapi import APIRouter, Depends, Query

from app.api.v1.deps.auth_deps import get_username
from app.core.responses import PaginatedResponse
from app.domains.acts.deps import get_users_repository
from app.domains.acts.schemas.act_metadata import UserSearchResult
from app.domains.admin.interfaces import IUserDirectory

router = APIRouter()

MIN_SEARCH_LENGTH = 2


@router.get("/users/search", response_model=PaginatedResponse[UserSearchResult])
async def search_users(
    q: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    username: str = Depends(get_username),
    repo: IUserDirectory = Depends(get_users_repository),
):
    """Поиск пользователей в справочнике по ФИО или логину.

    Требует аутентификации — справочник содержит ФИО и должности всех
    сотрудников и не должен быть доступен анонимно.
    """
    if len(q.strip()) < MIN_SEARCH_LENGTH:
        return PaginatedResponse[UserSearchResult](
            items=[], total=0, limit=limit, offset=offset,
        )
    query = q.strip()
    items = await repo.search_users(query, limit=limit, offset=offset)
    total = await repo.count_users(query)
    return PaginatedResponse[UserSearchResult](
        items=items, total=total, limit=limit, offset=offset,
    )
