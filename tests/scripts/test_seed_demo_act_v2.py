"""Проверка структуры _build_tree / _build_tables / _build_text_blocks / _build_violations
для новой версии демо-акта v2 (см. spec §3)."""
import pytest

from scripts.seed_demo_act import (
    _build_tree,
    _build_tables,
    _build_text_blocks,
    _build_violations,
    _DEMO_KM_DIGIT,
    DEMO_KM,
)


def _walk(node):
    """Yields все узлы дерева в depth-first порядке."""
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


def test_demo_km_constant_is_99_99999():
    assert DEMO_KM == "КМ-99-99999"
    assert _DEMO_KM_DIGIT == 9999999


def test_tree_has_six_root_sections():
    tree = _build_tree()
    sections = tree["children"]
    assert len(sections) == 6
    assert [s["id"] for s in sections] == ["1", "2", "3", "4", "5", "6"]


def test_sections_1_to_5_are_protected_and_not_deletable():
    tree = _build_tree()
    for section in tree["children"][:5]:
        assert section["protected"] is True
        assert section["deletable"] is False


def test_section_6_is_deletable_and_not_protected():
    tree = _build_tree()
    section_6 = tree["children"][5]
    assert section_6["protected"] is False
    assert section_6["deletable"] is True


def test_section_1_has_two_textblock_children_1_1_and_1_2():
    tree = _build_tree()
    sec1 = tree["children"][0]
    textblocks = [c for c in sec1["children"] if c.get("type") == "textblock"]
    assert len(textblocks) == 2


def test_section_2_has_single_textblock_with_hyperlink():
    tree = _build_tree()
    sec2 = tree["children"][1]
    textblocks = [c for c in sec2["children"] if c.get("type") == "textblock"]
    assert len(textblocks) == 1
    tb_id = textblocks[0]["textBlockId"]
    blocks = _build_text_blocks()
    assert "<a href" in blocks[tb_id].content


def test_section_3_has_pinned_main_metrics_and_textblock():
    tree = _build_tree()
    sec3 = tree["children"][2]
    children = sec3["children"]
    main_metrics = [c for c in children if c.get("isMainMetricsTable")]
    assert len(main_metrics) == 1
    textblocks = [c for c in children if c.get("type") == "textblock"]
    assert len(textblocks) == 1


def test_section_4_has_textblock_table_textblock():
    tree = _build_tree()
    sec4 = tree["children"][3]
    types = [c.get("type") for c in sec4["children"]]
    assert types == ["textblock", "table", "textblock"]


def test_section_5_subtree_5_1_5_1_1_5_1_2_5_2_5_2_1():
    tree = _build_tree()
    sec5 = tree["children"][4]
    ids = {n["id"] for n in _walk(sec5)}
    assert "5.1" in ids
    assert "5.1.1" in ids
    assert "5.1.2" in ids
    assert "5.2" in ids
    assert "5.2.1" in ids


def test_5_1_1_has_risk_tables_and_violation():
    tree = _build_tree()
    sec5 = tree["children"][4]
    node_5_1_1 = next(n for n in _walk(sec5) if n["id"] == "5.1.1")
    types_seen = {c.get("type") for c in node_5_1_1["children"]}
    assert "table" in types_seen
    assert "violation" in types_seen


def test_5_1_1_has_tb_assigned():
    tree = _build_tree()
    sec5 = tree["children"][4]
    node_5_1_1 = next(n for n in _walk(sec5) if n["id"] == "5.1.1")
    assert node_5_1_1.get("tb")
    assert len(node_5_1_1["tb"]) >= 1


def test_section_6_has_textblock_table_textblock():
    tree = _build_tree()
    sec6 = tree["children"][5]
    types = [c.get("type") for c in sec6["children"]]
    assert types == ["textblock", "table", "textblock"]


def test_violations_include_vnd_marker():
    violations = _build_violations()
    vnd_violations = [v for v in violations.values() if "Требования ВНД" in v.violated]
    assert len(vnd_violations) >= 1


def test_violations_include_legislation_marker():
    violations = _build_violations()
    law_violations = [
        v for v in violations.values() if "Требования законодательства" in v.violated
    ]
    assert len(law_violations) >= 1


def test_all_violations_have_recommendations_enabled():
    violations = _build_violations()
    for v in violations.values():
        assert v.recommendations.enabled is True
        assert v.recommendations.content.strip()


def test_text_blocks_contain_hyperlinks_in_multiple_sections():
    blocks = _build_text_blocks()
    count_with_a = sum(1 for b in blocks.values() if "<a href" in b.content)
    assert count_with_a >= 3
