"""Тесты аккумулятора tool-calls; покрывают quirks SGLang и MiniMax."""
import json
from types import SimpleNamespace as NS

from app.domains.chat.services.tool_call_accumulator import ToolCallAccumulator


def _delta(content=None, tool_calls=None, reasoning_details=None):
    return NS(content=content, tool_calls=tool_calls,
              reasoning_details=reasoning_details)


def _tc(index, tc_id=None, name=None, args=None):
    fn = NS(name=name, arguments=args) if (name or args) else None
    return NS(index=index, id=tc_id, function=fn)


def _chunk(delta, finish_reason=None):
    return NS(choices=[NS(delta=delta, finish_reason=finish_reason)])


def test_aggregates_single_tool_call():
    acc = ToolCallAccumulator()
    list(acc.consume(_chunk(_delta(tool_calls=[_tc(0, "tc_1", "search", '{"q":')]))))
    list(acc.consume(_chunk(_delta(tool_calls=[_tc(0, args='"hello"}')]))))
    calls = acc.finalize()
    assert len(calls) == 1
    assert calls[0].id == "tc_1"
    assert calls[0].name == "search"
    assert json.loads(calls[0].arguments) == {"q": "hello"}


def test_aggregates_parallel_tool_calls():
    acc = ToolCallAccumulator()
    list(acc.consume(_chunk(_delta(tool_calls=[
        _tc(0, "tc_1", "a", "{}"),
        _tc(1, "tc_2", "b", "{}"),
    ]))))
    calls = acc.finalize()
    assert {c.name for c in calls} == {"a", "b"}
    assert {c.id for c in calls} == {"tc_1", "tc_2"}


def test_sglang_index_none_fallback():
    """SGLang Llama-3.x иногда присылает index=None для после-первого-чанка."""
    acc = ToolCallAccumulator()
    list(acc.consume(_chunk(_delta(tool_calls=[_tc(0, "tc_1", "search", '{"x":1')]))))
    list(acc.consume(_chunk(_delta(tool_calls=[_tc(None, args='}')]))))
    calls = acc.finalize()
    assert len(calls) == 1
    assert json.loads(calls[0].arguments) == {"x": 1}


def test_collects_reasoning_details():
    """MiniMax M2: reasoning_details должны накапливаться отдельно."""
    acc = ToolCallAccumulator()
    list(acc.consume(_chunk(_delta(reasoning_details=[{"type": "text", "text": "...think..."}]))))
    list(acc.consume(_chunk(_delta(reasoning_details=[{"type": "text", "text": "...more..."}]))))
    assert acc.reasoning_details == [
        {"type": "text", "text": "...think..."},
        {"type": "text", "text": "...more..."},
    ]


def test_yields_content_deltas():
    acc = ToolCallAccumulator()
    events = list(acc.consume(_chunk(_delta(content="Hello "))))
    events += list(acc.consume(_chunk(_delta(content="world"))))
    assert events == [("content", "Hello "), ("content", "world")]


def test_empty_chunk_is_safe():
    """Чанк без choices не должен падать."""
    acc = ToolCallAccumulator()
    events = list(acc.consume(NS(choices=[])))
    assert events == []
    assert acc.finalize() == []


def test_no_tool_calls_in_delta_is_safe():
    """delta без tool_calls (None) не должна ронять."""
    acc = ToolCallAccumulator()
    events = list(acc.consume(_chunk(_delta(content="hi", tool_calls=None))))
    assert events == [("content", "hi")]
    assert acc.finalize() == []
