"""Тесты SSE-heartbeat'а (`with_heartbeat`).

Покрывает: pass-through нормальных событий, инъекцию heartbeat'а в
silence-периодах, корректное завершение по StopAsyncIteration,
проброс исключений источника, отмена внутренней задачи при отмене
снаружи (без утечек).
"""

import asyncio

import pytest

from app.domains.chat.services.streaming import (
    SSE_HEARTBEAT_PAYLOAD,
    with_heartbeat,
)


@pytest.mark.asyncio
async def test_passthrough_no_heartbeat_when_source_is_fast():
    """Источник, выдающий события быстрее интервала, не порождает heartbeat."""

    async def source():
        for i in range(3):
            yield f"event-{i}"

    items = []
    async for item in with_heartbeat(source(), interval_sec=1.0):
        items.append(item)

    assert items == ["event-0", "event-1", "event-2"]


@pytest.mark.asyncio
async def test_heartbeat_fires_when_source_is_silent():
    """В silence-период появляется хотя бы один heartbeat-payload."""

    async def slow_source():
        await asyncio.sleep(0.3)  # больше interval_sec
        yield "real"

    items = []
    async for item in with_heartbeat(slow_source(), interval_sec=0.1):
        items.append(item)

    assert SSE_HEARTBEAT_PAYLOAD in items
    assert "real" in items
    # heartbeat'ы стоят до реального события
    assert items.index(SSE_HEARTBEAT_PAYLOAD) < items.index("real")


@pytest.mark.asyncio
async def test_source_exception_propagates():
    """Если источник кидает исключение, with_heartbeat пробрасывает его."""

    class BoomError(Exception):
        pass

    async def broken_source():
        yield "first"
        raise BoomError("source died")

    items = []
    with pytest.raises(BoomError, match="source died"):
        async for item in with_heartbeat(broken_source(), interval_sec=1.0):
            items.append(item)

    assert items == ["first"]


@pytest.mark.asyncio
async def test_cancellation_does_not_leak_drainer_task():
    """При отмене внешнего consumer'а внутренняя _drain-задача завершается."""

    async def infinite_silent_source():
        await asyncio.sleep(10)  # бесконечная тишина
        yield "never"  # pragma: no cover

    gen = with_heartbeat(infinite_silent_source(), interval_sec=0.05)

    # Берём один heartbeat, потом закрываем генератор.
    first = await gen.__anext__()
    assert first == SSE_HEARTBEAT_PAYLOAD

    await gen.aclose()

    # Даём loop'у тик прибить таски.
    await asyncio.sleep(0.05)

    # В рантайме не должно быть висящих sse-heartbeat-drain.
    leaked = [
        t for t in asyncio.all_tasks()
        if t.get_name().startswith("sse-heartbeat-drain") and not t.done()
    ]
    assert leaked == []
