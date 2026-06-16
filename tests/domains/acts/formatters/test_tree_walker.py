"""Тесты единого tree-walker'а форматтеров (решение Б-2.2).

Walker отвечает ТОЛЬКО за обход и диспетч по типам узлов (включая единую
семантику «item с прикреплённой таблицей»); представление — целиком в
визиторах. Контракт: порядок вызовов = DFS-порядок дерева, контекст
(depth/parent) передаётся параметром, leaf-обработчики получают разрешённую
запись словаря (или None при висячей ссылке).
"""
import pytest

from app.domains.acts.formatters.tree_walker import (
    WalkContext,
    collect_blocks,
    walk,
)
from app.domains.acts.schemas.act_content import ActDataSchema


class RecordingVisitor:
    """Визитор-регистратор: пишет последовательность вызовов с контекстом."""

    def __init__(self):
        self.calls: list[tuple] = []

    def on_item_enter(self, node, ctx: WalkContext):
        self.calls.append(("enter", node["id"], ctx.depth))

    def on_item_exit(self, node, ctx: WalkContext):
        self.calls.append(("exit", node["id"], ctx.depth))

    def on_table(self, node, schema, ctx: WalkContext):
        self.calls.append(("table", node["id"], schema, ctx.depth))

    def on_textblock(self, node, schema, ctx: WalkContext):
        self.calls.append(("textblock", node["id"], schema, ctx.depth))

    def on_violation(self, node, schema, ctx: WalkContext):
        self.calls.append(("violation", node["id"], schema, ctx.depth))


def _tree(children) -> dict:
    return {"id": "root", "label": "Акт", "type": "item", "children": children}


def test_walk_dfs_order_and_depth():
    """Пункты обходятся в DFS-порядке: enter → дети → exit; depth детей корня 0."""
    tree = _tree([
        {"id": "s1", "type": "item", "label": "1", "children": [
            {"id": "n11", "type": "item", "label": "1.1", "children": [
                {"id": "n111", "type": "item", "label": "1.1.1", "children": []},
            ]},
        ]},
        {"id": "s2", "type": "item", "label": "2", "children": []},
    ])
    visitor = RecordingVisitor()
    walk(tree, visitor, {})
    assert visitor.calls == [
        ("enter", "s1", 0),
        ("enter", "n11", 1),
        ("enter", "n111", 2),
        ("exit", "n111", 2),
        ("exit", "n11", 1),
        ("exit", "s1", 0),
        ("enter", "s2", 0),
        ("exit", "s2", 0),
    ]


def test_walk_root_is_not_visited():
    """Корень дерева не посещается — обход начинается с его детей."""
    visitor = RecordingVisitor()
    walk(_tree([]), visitor, {})
    assert visitor.calls == []


def test_walk_dispatches_leaf_types_with_resolved_schema():
    """Leaf-типы диспетчатся в свои обработчики с записью словаря."""
    tree = _tree([
        {"id": "s1", "type": "item", "label": "1", "children": [
            {"id": "nt", "type": "table", "tableId": "t1", "children": []},
            {"id": "nb", "type": "textblock", "textBlockId": "tb1", "children": []},
            {"id": "nv", "type": "violation", "violationId": "v1", "children": []},
        ]},
    ])
    blocks = {
        "tables": {"t1": {"id": "t1"}},
        "textBlocks": {"tb1": {"id": "tb1"}},
        "violations": {"v1": {"id": "v1"}},
    }
    visitor = RecordingVisitor()
    walk(tree, visitor, blocks)
    assert visitor.calls == [
        ("enter", "s1", 0),
        ("table", "nt", {"id": "t1"}, 1),
        ("textblock", "nb", {"id": "tb1"}, 1),
        ("violation", "nv", {"id": "v1"}, 1),
        ("exit", "s1", 0),
    ]


def test_walk_dangling_ref_passes_none_schema():
    """Висячая/отсутствующая ссылка → обработчик получает schema=None.

    Решение остаётся за визитором (MD/TXT выводят заголовок узла-таблицы
    даже без данных, DOCX не выводит ничего).
    """
    tree = _tree([
        {"id": "nt", "type": "table", "tableId": "missing", "children": []},
        {"id": "nb", "type": "textblock", "children": []},
    ])
    visitor = RecordingVisitor()
    walk(tree, visitor, {"tables": {}, "textBlocks": {}, "violations": {}})
    assert visitor.calls == [
        ("table", "nt", None, 0),
        ("textblock", "nb", None, 0),
    ]


def test_walk_item_with_attached_table():
    """Единая семантика «item с tableId»: enter → on_table(тем же узлом) → exit.

    Это фикс потери в DOCX (узел item с прикреплённой таблицей): walker
    диспетчит таблицу для ЛЮБОГО визитора, представление решает визитор.
    """
    tree = _tree([
        {"id": "n12", "type": "item", "label": "1.2", "tableId": "t1",
         "children": [
             {"id": "n121", "type": "item", "label": "1.2.1", "children": []},
         ]},
    ])
    visitor = RecordingVisitor()
    walk(tree, visitor, {"tables": {"t1": {"id": "t1"}}})
    assert visitor.calls == [
        ("enter", "n12", 0),
        ("table", "n12", {"id": "t1"}, 0),
        ("enter", "n121", 1),
        ("exit", "n121", 1),
        ("exit", "n12", 0),
    ]


def test_walk_item_with_dangling_table_ref_skips_dispatch():
    """Висячий tableId у item-узла не диспетчится (как во всех форматтерах)."""
    tree = _tree([
        {"id": "n12", "type": "item", "label": "1.2", "tableId": "missing",
         "children": []},
    ])
    visitor = RecordingVisitor()
    walk(tree, visitor, {"tables": {}})
    assert visitor.calls == [("enter", "n12", 0), ("exit", "n12", 0)]


def test_walk_parent_in_context():
    """Контекст несёт родителя узла (для детей корня — сам корень)."""
    parents: dict[str, str] = {}

    class ParentVisitor(RecordingVisitor):
        def on_item_enter(self, node, ctx):
            parents[node["id"]] = ctx.parent["id"]

    tree = _tree([
        {"id": "s1", "type": "item", "label": "1", "children": [
            {"id": "n11", "type": "item", "label": "1.1", "children": []},
        ]},
    ])
    walk(tree, ParentVisitor(), {})
    assert parents == {"s1": "root", "n11": "s1"}


def test_walk_missing_type_defaults_to_item():
    """Узел без поля type обходится как item (дефолт схемы)."""
    visitor = RecordingVisitor()
    walk(_tree([{"id": "x", "label": "X", "children": []}]), visitor, {})
    assert visitor.calls == [("enter", "x", 0), ("exit", "x", 0)]


def test_collect_blocks_from_dict_and_schema():
    """collect_blocks работает и с raw dict (MD/TXT), и с ActDataSchema (DOCX)."""
    raw = {
        "tree": {"id": "root", "label": "Акт", "children": []},
        "tables": {"t1": {"id": "t1", "nodeId": "n", "grid": []}},
        "textBlocks": {},
        "violations": {},
    }
    from_dict = collect_blocks(raw)
    assert set(from_dict) == {"tables", "textBlocks", "violations"}
    assert "t1" in from_dict["tables"]

    model = ActDataSchema.model_validate(
        {**raw, "tables": {}}  # без таблицы: t1 не сошлась бы с nodeId
    )
    from_model = collect_blocks(model)
    assert set(from_model) == {"tables", "textBlocks", "violations"}
    assert from_model["tables"] == {}
