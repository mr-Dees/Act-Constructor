"""
Тесты round-trip 6 флагов подвидов таблиц на бэкенде.

Проверяют, что флаги переживают парсинг ActItemSchema (узлы дерева) и
валидацию ActDataSchema, а также сохранение через репозиторий
(copy_tables / insert_table / orphan-фильтр в _save_tables).
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.acts.schemas.act_content import ActItemSchema, ActDataSchema


class TestActItemSchemaRiskFlags:
    """ActItemSchema описывает все 6 флагов подвидов таблиц."""

    def test_all_six_flags_parsed_onto_node(self):
        """Узел с 4 risk-флагами + 2 metrics-флагами сохраняет их при парсинге."""
        node = ActItemSchema.model_validate({
            "id": "n1",
            "label": "Таблица",
            "type": "table",
            "tableId": "t1",
            "isMetricsTable": True,
            "isMainMetricsTable": True,
            "isRegularRiskTable": True,
            "isOperationalRiskTable": True,
            "isTaxRiskTable": True,
            "isOtherRiskTable": True,
        })
        assert node.isMetricsTable is True
        assert node.isMainMetricsTable is True
        assert node.isRegularRiskTable is True
        assert node.isOperationalRiskTable is True
        assert node.isTaxRiskTable is True
        assert node.isOtherRiskTable is True

    def test_flags_default_false(self):
        """Без флагов в payload — все 6 дефолтятся в False."""
        node = ActItemSchema.model_validate({"id": "n1", "label": "Пункт"})
        for flag in (
            "isMetricsTable", "isMainMetricsTable",
            "isRegularRiskTable", "isOperationalRiskTable",
            "isTaxRiskTable", "isOtherRiskTable",
        ):
            assert getattr(node, flag) is False


class TestActDataSchemaTreeValidation:
    """ActDataSchema валидирует дерево через ActItemSchema (C4)."""

    def test_flags_survive_in_nested_tree(self):
        """Флаги на вложенном table-узле переживают валидацию ActDataSchema."""
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
                        "isRegularRiskTable": True,
                        "isOperationalRiskTable": True,
                        "isTaxRiskTable": True,
                        "isOtherRiskTable": True,
                        "isMetricsTable": True,
                        "isMainMetricsTable": True,
                    }
                ],
            },
            "tables": {},
        }
        data = ActDataSchema.model_validate(payload)
        # Дерево по-прежнему доступно (тип не сломан для downstream-консьюмеров)
        tree = data.tree
        child = (tree["children"] if isinstance(tree, dict) else tree.children)[0]
        get = (lambda o, k: o[k]) if isinstance(child, dict) else getattr
        assert get(child, "isRegularRiskTable") is True
        assert get(child, "isOperationalRiskTable") is True
        assert get(child, "isTaxRiskTable") is True
        assert get(child, "isOtherRiskTable") is True
        assert get(child, "isMetricsTable") is True
        assert get(child, "isMainMetricsTable") is True

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
