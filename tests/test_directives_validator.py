"""Тесты для ActDirectivesValidator — валидация ссылок поручений."""

import pytest

from app.domains.acts.schemas.act_metadata import ActDirective
from app.domains.acts.utils.act_directives_validator import ActDirectivesValidator


# ── Фикстуры ──


@pytest.fixture
def tree_with_numbers():
    """Дерево с номерами узлов в разделах 1 и 5."""
    return {
        "id": "root",
        "number": "0",
        "type": "item",
        "children": [
            {"id": "1", "number": "1", "type": "item", "children": []},
            {"id": "2", "number": "2", "type": "item", "children": []},
            {"id": "5", "number": "5", "type": "item", "children": [
                {"id": "node_1711270400100_abc1234", "number": "5.1", "type": "item", "children": [
                    {"id": "node_1711270400200_def5678", "number": "5.1.1", "type": "item", "children": []},
                ]},
                {"id": "node_1711270400300_ghi9012", "number": "5.2", "type": "item", "children": []},
            ]},
        ],
    }


@pytest.fixture
def tree_with_audit_ids():
    """Дерево с auditPointId для build_audit_point_map."""
    return {
        "id": "root",
        "type": "item",
        "auditPointId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "children": [
            {
                "id": "node_1711270400100_abc1234",
                "type": "item",
                "auditPointId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
                "children": [
                    {
                        "id": "node_1711270400100_abc1234_table_1711270400200_xyz7890",
                        "type": "table",
                        "children": [],
                    },
                ],
            },
            {
                "id": "node_1711270400300_jkl3456",
                "type": "item",
                "children": [],
            },
        ],
    }


# ── collect_node_numbers ──


class TestCollectNodeNumbers:

    def test_collects_all_numbers(self, tree_with_numbers):
        nums = ActDirectivesValidator.collect_node_numbers(tree_with_numbers)
        assert nums == {"0", "1", "2", "5", "5.1", "5.1.1", "5.2"}

    def test_empty_tree(self):
        nums = ActDirectivesValidator.collect_node_numbers({"children": []})
        assert nums == set()

    def test_node_without_number(self):
        tree = {"children": [{"id": "x", "children": []}]}
        nums = ActDirectivesValidator.collect_node_numbers(tree)
        assert nums == set()

    def test_non_dict_child_skipped(self):
        tree = {"number": "1", "children": ["invalid", None, 42]}
        nums = ActDirectivesValidator.collect_node_numbers(tree)
        assert nums == {"1"}


# ── validate_directives_points ──


class TestValidateDirectivesPoints:

    def test_valid_directives(self, tree_with_numbers):
        points = ActDirectivesValidator.collect_node_numbers(tree_with_numbers)
        directives = [
            ActDirective(point_number="5.1", directive_number="П-001"),
            ActDirective(point_number="5.2", directive_number="П-002"),
        ]
        ActDirectivesValidator.validate_directives_points(directives, points)

    def test_non_section_5_raises(self):
        directives = [
            ActDirective(point_number="5.1", directive_number="П-001"),
        ]
        # point_number="5.1" but starts with "5." — нужно заставить пройти
        # валидатор schema, но потом подставить не-5 точку
        d = ActDirective.model_construct(point_number="3.1", directive_number="П-001")
        with pytest.raises(ValueError, match="разделе 5"):
            ActDirectivesValidator.validate_directives_points([d], {"5.1", "3.1"})

    def test_nonexistent_point_raises(self):
        d = ActDirective(point_number="5.1", directive_number="П-001")
        with pytest.raises(ValueError, match="несуществующий"):
            ActDirectivesValidator.validate_directives_points([d], {"5.2"})

    def test_empty_directives_ok(self):
        ActDirectivesValidator.validate_directives_points([], set())


# ── build_audit_point_map ──


class TestBuildAuditPointMap:

    def test_maps_item_nodes(self, tree_with_audit_ids):
        result = ActDirectivesValidator.build_audit_point_map(tree_with_audit_ids)
        assert result["root"] == "f47ac10b-58cc-4372-a567-0e02b2c3d479"
        assert result["node_1711270400100_abc1234"] == "b2c3d4e5-f6a7-8901-bcde-f12345678901"

    def test_skips_content_nodes(self, tree_with_audit_ids):
        result = ActDirectivesValidator.build_audit_point_map(tree_with_audit_ids)
        assert "node_1711270400100_abc1234_table_1711270400200_xyz7890" not in result

    def test_skips_nodes_without_audit_point_id(self, tree_with_audit_ids):
        result = ActDirectivesValidator.build_audit_point_map(tree_with_audit_ids)
        assert "node_1711270400300_jkl3456" not in result

    def test_empty_tree(self):
        result = ActDirectivesValidator.build_audit_point_map(
            {"id": "r", "type": "item", "children": []}
        )
        assert result == {}
