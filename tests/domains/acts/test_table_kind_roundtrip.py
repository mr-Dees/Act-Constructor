"""
Тесты round-trip подвида таблицы (enum kind) на бэкенде.

Проверяют, что kind переживает парсинг ActItemSchema (узлы дерева) и
валидацию ActDataSchema, что неизвестный kind отбивается 422-семантикой,
а также сохранение через репозиторий (copy_tables).
"""
from typing import get_args
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.domains.acts.schemas.act_content import (
    TABLE_KINDS,
    ActDataSchema,
    ActItemSchema,
    TableKind,
    TableSchema,
)
from app.domains.acts.repositories.act_crud import ActCrudRepository


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


def test_table_kind_literal_matches_tuple():
    """Literal TableKind и tuple TABLE_KINDS объявляют одинаковый набор значений."""
    assert set(get_args(TableKind)) == set(TABLE_KINDS)
    # Дубликатов нет ни там, ни там.
    assert len(get_args(TableKind)) == len(TABLE_KINDS) == 7


class TestActItemSchemaKind:
    """ActItemSchema описывает подвид таблицы единым полем kind."""

    @pytest.mark.parametrize("kind", TABLE_KINDS)
    def test_every_kind_parsed_onto_node(self, kind):
        """Каждое значение kind сохраняется на узле при парсинге."""
        node = ActItemSchema.model_validate({
            "id": "n1",
            "label": "Таблица",
            "type": "table",
            "tableId": "t1",
            "kind": kind,
        })
        assert node.kind == kind

    def test_kind_defaults_to_regular(self):
        """Без kind в payload узел получает 'regular'."""
        node = ActItemSchema.model_validate({"id": "n1", "label": "Пункт"})
        assert node.kind == "regular"

    def test_unknown_kind_rejected(self):
        """Неизвестный kind отбраковывается (→ HTTP 422)."""
        with pytest.raises(ValidationError):
            ActItemSchema.model_validate({
                "id": "n1", "label": "Таблица", "type": "table",
                "kind": "superRisk",
            })


class TestTableSchemaKind:
    """TableSchema описывает подвид таблицы единым полем kind."""

    @pytest.mark.parametrize("kind", TABLE_KINDS)
    def test_every_kind_accepted(self, kind):
        t = TableSchema(id="t1", nodeId="n1", kind=kind)
        assert t.kind == kind

    def test_kind_defaults_to_regular(self):
        t = TableSchema(id="t1", nodeId="n1")
        assert t.kind == "regular"

    def test_unknown_kind_rejected(self):
        with pytest.raises(ValidationError):
            TableSchema(id="t1", nodeId="n1", kind="superRisk")

    def test_legacy_flag_field_rejected(self):
        """Старый флаг is*Table — неизвестное поле (extra='forbid') → 422."""
        with pytest.raises(ValidationError):
            TableSchema.model_validate(
                {"id": "t1", "nodeId": "n1", "isMetricsTable": True}
            )


class TestActDataSchemaTreeValidation:
    """ActDataSchema валидирует дерево через ActItemSchema (C4)."""

    def test_kind_survives_in_nested_tree(self):
        """kind на вложенном table-узле переживает валидацию ActDataSchema."""
        payload = {
            "tree": {
                "id": "root",
                "label": "Акт",
                "children": [
                    {
                        "id": "n1",
                        "label": "Таблица рисков",
                        "type": "table",
                        "tableId": "t1",
                        "kind": "operationalRisk",
                    }
                ],
            },
            # Запись словаря обязана существовать: кросс-валидатор M.13
            # отбивает висячие ссылки tableId из дерева.
            "tables": {"t1": {"id": "t1", "nodeId": "n1", "kind": "operationalRisk"}},
        }
        data = ActDataSchema.model_validate(payload)
        child = data.tree["children"][0]
        assert child["kind"] == "operationalRisk"
        assert data.tables["t1"].kind == "operationalRisk"

    def test_invalid_tree_structure_rejected(self):
        """Дерево без обязательных полей узла отбраковывается валидацией."""
        payload = {
            "tree": {
                "id": "root",
                "label": "Акт",
                "children": [{"type": "table"}],  # нет id/label
            },
            "tables": {},
        }
        with pytest.raises(Exception):
            ActDataSchema.model_validate(payload)


class TestCopyTablesKind:
    """copy_tables копирует подвид таблицы (kind)."""

    async def test_copy_tables_sql_lists_kind(self, mock_conn):
        """SQL copy_tables перечисляет колонку kind и в INSERT, и в SELECT."""
        repo = ActCrudRepository(mock_conn)
        await repo.copy_tables(from_id=1, to_id=2)

        sql = mock_conn.execute.call_args.args[0]
        # Колонка должна встречаться дважды: в списке INSERT и в SELECT
        assert sql.count("kind") >= 2, (
            f"copy_tables не копирует kind (встречается {sql.count('kind')} раз)"
        )
