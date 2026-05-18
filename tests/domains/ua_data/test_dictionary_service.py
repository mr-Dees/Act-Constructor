"""
Тесты фасада DictionaryService.

Покрытие:
- Фасад делегирует каждый метод 1-в-1 в IDictionaryRepository.
- Возвращает данные репозитория без модификаций.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.domains.ua_data.interfaces import IDictionaryRepository
from app.domains.ua_data.services.dictionary_service import DictionaryService


@pytest.fixture
def mock_repo() -> MagicMock:
    """Мок репозитория с async-методами по спецификации IDictionaryRepository."""
    repo = MagicMock(spec=IDictionaryRepository)
    for method_name in (
        "get_processes",
        "get_terbanks",
        "get_metric_codes",
        "get_departments",
        "get_channels",
        "get_products",
        "get_risk_types",
        "get_teams",
    ):
        setattr(repo, method_name, AsyncMock(return_value=[]))
    return repo


@pytest.fixture
def service(mock_repo: MagicMock) -> DictionaryService:
    return DictionaryService(repo=mock_repo)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "method_name,payload",
    [
        ("get_processes", [{"id": 1, "process_code": "P-001"}]),
        ("get_terbanks", [{"tb_id": 10, "short_name": "ТБ-1"}]),
        ("get_metric_codes", [{"id": 5, "code": "M-001"}]),
        ("get_departments", [{"id": 7, "tb_id": 10}]),
        ("get_channels", [{"id": 1, "channel": "Онлайн"}]),
        ("get_products", [{"id": 1, "product_name": "Кредит"}]),
        ("get_risk_types", [{"id": 1, "risk": "Операционный"}]),
        ("get_teams", [{"id": 1, "tb_id": 10, "username": "user1"}]),
    ],
)
async def test_facade_delegates_one_to_one(
    service: DictionaryService,
    mock_repo: MagicMock,
    method_name: str,
    payload: list[dict],
):
    """Каждый метод фасада вызывает одноимённый метод репозитория и возвращает его результат."""
    getattr(mock_repo, method_name).return_value = payload

    result = await getattr(service, method_name)()

    assert result == payload
    getattr(mock_repo, method_name).assert_awaited_once_with()


def test_service_accepts_idictionary_repository_protocol():
    """DictionaryService принимает любой объект, удовлетворяющий IDictionaryRepository."""
    repo = MagicMock(spec=IDictionaryRepository)
    service = DictionaryService(repo=repo)
    assert service._repo is repo
