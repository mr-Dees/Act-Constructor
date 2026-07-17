"""
Дедупликация версий содержимого (доработка F2).

manual/periodic-сохранение неизменённого акта не создаёт версию-дубль: репозиторий
считает канонический SHA-256 содержимого и сравнивает с хэшем последней версии.
Тесты проверяют:
  - совпадение хэша → INSERT пропущен, вернулся None (пруннинг не запускается);
  - расхождение хэша → INSERT выполнен, вернулся version_number;
  - отсутствие предыдущей версии (NULL) → INSERT выполнен;
  - канонический хэш стабилен к порядку ключей;
  - волатильные поля фактур (id/таймстемпы БД) в хэш не входят.
"""

from unittest.mock import patch

import pytest

from app.domains.acts.repositories.act_content_version import (
    ActContentVersionRepository,
    compute_content_hash,
)


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


# --- дедуп в create_version ------------------------------------------------

async def test_skips_insert_when_hash_matches_latest(mock_conn):
    """Хэш нового снимка == хэш последней версии → INSERT пропущен, вернулся None."""
    tree = {"id": "root", "children": []}
    # Хэш ровно того содержимого, что уйдёт в create_version (invoices=None → {}).
    mock_conn.fetchval.return_value = compute_content_hash(tree, {}, {}, {}, {})
    repo = ActContentVersionRepository(mock_conn)

    result = await repo.create_version(
        act_id=1, username="12345", save_type="manual",
        tree=tree, tables={}, textblocks={}, violations={},
    )

    assert result is None
    mock_conn.fetchrow.assert_not_called()  # снимок не вставлялся
    mock_conn.execute.assert_not_called()   # пруннинг старых версий не запускался


async def test_inserts_when_hash_differs(mock_conn):
    """Хэш расходится с последней версией → INSERT выполнен, вернулся номер."""
    mock_conn.fetchval.return_value = "0" * 64  # чужой хэш
    mock_conn.fetchrow.return_value = {"version_number": 4}
    mock_conn.execute.return_value = "DELETE 0"
    repo = ActContentVersionRepository(mock_conn)

    result = await repo.create_version(
        act_id=1, username="12345", save_type="manual",
        tree={"id": "root", "children": [{"id": "x"}]},
        tables={}, textblocks={}, violations={},
    )

    assert result == 4
    mock_conn.fetchrow.assert_called_once()
    # content_hash — последний позиционный аргумент INSERT (64 hex sha256).
    assert len(mock_conn.fetchrow.call_args.args[-1]) == 64


async def test_inserts_when_no_previous_version(mock_conn):
    """Предыдущих версий нет (fetchval → NULL) → снимок создаётся."""
    mock_conn.fetchval.return_value = None
    mock_conn.fetchrow.return_value = {"version_number": 1}
    mock_conn.execute.return_value = "DELETE 0"
    repo = ActContentVersionRepository(mock_conn)

    result = await repo.create_version(
        act_id=1, username="12345", save_type="manual",
        tree={}, tables={}, textblocks={}, violations={},
    )

    assert result == 1
    mock_conn.fetchrow.assert_called_once()


# --- канонический хэш ------------------------------------------------------

def test_hash_stable_regardless_of_key_order():
    """Логически равные документы дают равный хэш независимо от порядка ключей."""
    a = compute_content_hash({"a": 1, "b": 2}, {"t1": {"x": 1, "y": 2}}, {}, {}, {})
    b = compute_content_hash({"b": 2, "a": 1}, {"t1": {"y": 2, "x": 1}}, {}, {}, {})
    assert a == b


def test_hash_differs_when_content_changes():
    """Изменение содержимого дерева меняет хэш."""
    assert compute_content_hash({"id": "a"}, {}, {}, {}, {}) != \
        compute_content_hash({"id": "b"}, {}, {}, {}, {})


def test_hash_ignores_volatile_invoice_fields():
    """id/created_at/updated_at фактуры не влияют на хэш; реальные поля — влияют."""
    base = {"n5": {"node_id": "n5", "table_name": "t1"}}
    with_volatile = {"n5": {
        "node_id": "n5", "table_name": "t1",
        "id": 999, "created_at": "2026-01-01", "updated_at": "2026-07-17",
    }}
    assert compute_content_hash({}, {}, {}, {}, base) == \
        compute_content_hash({}, {}, {}, {}, with_volatile)

    changed = {"n5": {"node_id": "n5", "table_name": "t2"}}  # реальное поле фактуры
    assert compute_content_hash({}, {}, {}, {}, base) != \
        compute_content_hash({}, {}, {}, {}, changed)


def test_hash_none_invoices_equals_empty_dict():
    """invoices=None и invoices={} дают одинаковый хэш (нормализация)."""
    assert compute_content_hash({"id": "r"}, {}, {}, {}, None) == \
        compute_content_hash({"id": "r"}, {}, {}, {}, {})
