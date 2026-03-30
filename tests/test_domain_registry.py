"""Тесты для domain_registry — топологическая сортировка доменов."""

import pytest

from app.core.domain import DomainDescriptor
from app.core.domain_registry import _toposort, get_all_domains, get_domain, reset_registry


@pytest.fixture(autouse=True)
def clean_registry():
    reset_registry()
    yield
    reset_registry()


def _desc(name, deps=None):
    return DomainDescriptor(name=name, dependencies=deps or [])


# ── _toposort ──


class TestToposort:

    def test_no_dependencies(self):
        domains = [_desc("a"), _desc("b"), _desc("c")]
        result = _toposort(domains)
        names = [d.name for d in result]
        assert sorted(names) == ["a", "b", "c"]

    def test_linear_chain(self):
        domains = [_desc("c", ["b"]), _desc("b", ["a"]), _desc("a")]
        result = _toposort(domains)
        names = [d.name for d in result]
        assert names.index("a") < names.index("b") < names.index("c")

    def test_diamond_dependency(self):
        domains = [
            _desc("d", ["b", "c"]),
            _desc("b", ["a"]),
            _desc("c", ["a"]),
            _desc("a"),
        ]
        result = _toposort(domains)
        names = [d.name for d in result]
        assert names.index("a") < names.index("b")
        assert names.index("a") < names.index("c")
        assert names.index("b") < names.index("d")
        assert names.index("c") < names.index("d")

    def test_cycle_raises(self):
        domains = [_desc("a", ["b"]), _desc("b", ["a"])]
        with pytest.raises(RuntimeError, match="Циклическая"):
            _toposort(domains)

    def test_unknown_dependency_raises(self):
        domains = [_desc("a", ["missing"])]
        with pytest.raises(RuntimeError, match="неизвестных"):
            _toposort(domains)

    def test_single_domain(self):
        result = _toposort([_desc("only")])
        assert len(result) == 1
        assert result[0].name == "only"

    def test_empty_list(self):
        assert _toposort([]) == []


# ── get_domain / get_all_domains ──


class TestRegistryLookup:

    def test_get_domain_returns_none_when_empty(self):
        assert get_domain("acts") is None

    def test_get_all_domains_empty(self):
        assert get_all_domains() == []
