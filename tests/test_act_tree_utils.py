"""Тесты для ActTreeUtils — утилиты обхода дерева структуры акта."""

import pytest

from app.domains.acts.utils.act_tree_utils import ActTreeUtils


# ── Фикстуры ──


@pytest.fixture
def sample_tree():
    """Дерево акта с реалистичной структурой: разделы 1, 5 с вложенными пунктами."""
    return {
        "id": "root",
        "label": "Акт",
        "number": "0",
        "type": "item",
        "children": [
            {
                "id": "1",
                "label": "Информация о процессе, клиентском пути",
                "number": "1",
                "type": "item",
                "protected": True,
                "deletable": False,
                "auditPointId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
                "children": [
                    {
                        "id": "node_1711270400123_7a4k9b2",
                        "label": "Описание процесса кредитования",
                        "number": "1.1",
                        "type": "item",
                        "auditPointId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                        "children": [
                            {
                                "id": "node_1711270400123_7a4k9b2_table_1711270400456_3x2m8p1",
                                "label": "Таблица",
                                "type": "table",
                                "tableId": "table_1711270400456_3x2m8p1",
                                "children": [],
                            },
                        ],
                    },
                ],
            },
            {
                "id": "5",
                "label": "Результаты проверки",
                "number": "5",
                "type": "item",
                "protected": True,
                "deletable": False,
                "children": [],
            },
        ],
    }


@pytest.fixture
def flat_tree():
    """Дерево без дочерних узлов."""
    return {"id": "root", "label": "Акт", "number": "0", "children": []}


# ── extract_node_number ──


class TestExtractNodeNumber:

    def test_root_node(self, sample_tree):
        assert ActTreeUtils.extract_node_number(sample_tree, "root") == "0"

    def test_nested_node(self, sample_tree):
        assert ActTreeUtils.extract_node_number(sample_tree, "node_1711270400123_7a4k9b2") == "1.1"

    def test_not_found(self, sample_tree):
        assert ActTreeUtils.extract_node_number(sample_tree, "missing") is None

    def test_content_node_no_number(self, sample_tree):
        assert ActTreeUtils.extract_node_number(sample_tree, "node_1711270400123_7a4k9b2_table_1711270400456_3x2m8p1") is None

    def test_with_current_node(self, sample_tree):
        subtree = sample_tree["children"][0]
        assert ActTreeUtils.extract_node_number(sample_tree, "1", subtree) == "1"


# ── find_node_label ──


class TestFindNodeLabel:

    def test_root(self, sample_tree):
        assert ActTreeUtils.find_node_label(sample_tree, "root") == "Акт"

    def test_nested(self, sample_tree):
        assert ActTreeUtils.find_node_label(sample_tree, "1") == "Информация о процессе, клиентском пути"

    def test_deep_nested(self, sample_tree):
        assert ActTreeUtils.find_node_label(sample_tree, "node_1711270400123_7a4k9b2") == "Описание процесса кредитования"

    def test_not_found(self, sample_tree):
        assert ActTreeUtils.find_node_label(sample_tree, "nope") is None


# ── find_parent_item_node_id ──


class TestFindParentItemNodeId:

    def test_item_returns_self(self, sample_tree):
        result = ActTreeUtils.find_parent_item_node_id(sample_tree, "1")
        assert result == "1"

    def test_content_returns_parent_item(self, sample_tree):
        result = ActTreeUtils.find_parent_item_node_id(sample_tree, "node_1711270400123_7a4k9b2_table_1711270400456_3x2m8p1")
        assert result == "node_1711270400123_7a4k9b2"

    def test_root_returns_self(self, sample_tree):
        result = ActTreeUtils.find_parent_item_node_id(sample_tree, "root")
        assert result == "root"

    def test_not_found(self, sample_tree):
        result = ActTreeUtils.find_parent_item_node_id(sample_tree, "missing")
        assert result is None


# ── calculate_tree_depth ──


class TestCalculateTreeDepth:

    def test_flat(self, flat_tree):
        assert ActTreeUtils.calculate_tree_depth(flat_tree) == 0

    def test_sample_tree(self, sample_tree):
        # root -> "1" -> node_...7a4k9b2 -> node_...table_... = глубина 3
        assert ActTreeUtils.calculate_tree_depth(sample_tree) == 3

    def test_custom_start_depth(self, sample_tree):
        assert ActTreeUtils.calculate_tree_depth(sample_tree, current_depth=5) == 8

    def test_single_node(self):
        assert ActTreeUtils.calculate_tree_depth({"id": "x"}) == 0

    def test_wide_tree(self):
        tree = {
            "id": "root",
            "children": [{"id": f"c{i}", "children": []} for i in range(10)],
        }
        assert ActTreeUtils.calculate_tree_depth(tree) == 1
