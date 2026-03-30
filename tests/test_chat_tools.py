"""Тесты для реестра ChatTool и конвертации в OpenAI формат."""

import pytest

from app.core.chat_tools import (
    ChatTool,
    ChatToolParam,
    get_all_tools,
    get_openai_tools,
    get_tool,
    get_tools_by_domain,
    register_tools,
    reset,
)


@pytest.fixture(autouse=True)
def clean_registry():
    """Сбрасывает реестр chat tools между тестами."""
    reset()
    yield
    reset()


def _make_tool(name="test_tool", domain="test", **kwargs):
    return ChatTool(name=name, domain=domain, description="desc", **kwargs)


# ── Реестр ──


class TestRegistry:

    def test_register_and_get(self):
        tool = _make_tool()
        register_tools([tool])
        assert get_tool("test_tool") is tool

    def test_get_nonexistent(self):
        assert get_tool("missing") is None

    def test_get_all(self):
        register_tools([_make_tool("a"), _make_tool("b")])
        assert len(get_all_tools()) == 2

    def test_filter_by_domain(self):
        register_tools([
            _make_tool("a", domain="acts"),
            _make_tool("b", domain="acts"),
            _make_tool("c", domain="other"),
        ])
        result = get_tools_by_domain("acts")
        assert len(result) == 2
        assert all(t.domain == "acts" for t in result)

    def test_duplicate_name_raises(self):
        register_tools([_make_tool("dup")])
        with pytest.raises(RuntimeError, match="уже зарегистрирован"):
            register_tools([_make_tool("dup", domain="other")])

    def test_reset_clears(self):
        register_tools([_make_tool()])
        reset()
        assert get_all_tools() == []


# ── to_openai_tool ──


class TestToOpenaiTool:

    def test_basic_conversion(self):
        tool = _make_tool(
            parameters=[
                ChatToolParam(name="query", type="string", description="Search query"),
            ]
        )
        result = tool.to_openai_tool()
        assert result["type"] == "function"
        assert result["function"]["name"] == "test_tool"
        props = result["function"]["parameters"]["properties"]
        assert "query" in props
        assert props["query"]["type"] == "string"

    def test_required_params(self):
        tool = _make_tool(parameters=[
            ChatToolParam(name="a", type="string", description="req", required=True),
            ChatToolParam(name="b", type="string", description="opt", required=False),
        ])
        result = tool.to_openai_tool()
        required = result["function"]["parameters"]["required"]
        assert "a" in required
        assert "b" not in required

    def test_date_type_mapping(self):
        tool = _make_tool(parameters=[
            ChatToolParam(name="d", type="date", description="date field"),
        ])
        result = tool.to_openai_tool()
        prop = result["function"]["parameters"]["properties"]["d"]
        assert prop["type"] == "string"
        assert prop["format"] == "date"

    def test_enum_param(self):
        tool = _make_tool(parameters=[
            ChatToolParam(
                name="fmt", type="string", description="format",
                enum=["text", "docx"],
            ),
        ])
        result = tool.to_openai_tool()
        prop = result["function"]["parameters"]["properties"]["fmt"]
        assert prop["enum"] == ["text", "docx"]

    def test_array_param(self):
        tool = _make_tool(parameters=[
            ChatToolParam(
                name="ids", type="array", description="list",
                items_type="integer",
            ),
        ])
        result = tool.to_openai_tool()
        prop = result["function"]["parameters"]["properties"]["ids"]
        assert prop["type"] == "array"
        assert prop["items"] == {"type": "integer"}

    def test_default_value(self):
        tool = _make_tool(parameters=[
            ChatToolParam(
                name="limit", type="integer", description="limit",
                default=10, required=False,
            ),
        ])
        result = tool.to_openai_tool()
        prop = result["function"]["parameters"]["properties"]["limit"]
        assert prop["default"] == 10

    def test_no_params(self):
        tool = _make_tool()
        result = tool.to_openai_tool()
        assert result["function"]["parameters"]["properties"] == {}
        assert result["function"]["parameters"]["required"] == []

    def test_additional_properties_false(self):
        tool = _make_tool()
        result = tool.to_openai_tool()
        assert result["function"]["parameters"]["additionalProperties"] is False


class TestGetOpenaiTools:

    def test_converts_all(self):
        register_tools([_make_tool("a"), _make_tool("b")])
        result = get_openai_tools()
        assert len(result) == 2
        assert all(r["type"] == "function" for r in result)
