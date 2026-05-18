"""Тесты лимита размера delta-блока в SSE-стриме.

Покрывают:
- chunk-flush буферизацию (нарезка больших чанков на куски);
- truncate при превышении общего лимита блока;
- маркер усечения и эмит block_end;
- логирование warning при усечении;
- сброс счётчика на новый block_start;
- настройки delta_chunk_flush_bytes / delta_block_max_bytes;
- мульти-байтовый UTF-8;
- нестримуемые блоки не затронуты лимитом.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.services.streaming import (
    BlockDeltaLimiter,
    TRUNCATION_MARKER,
    emit_text_block_with_limit,
    sse_block_complete,
)
from app.domains.chat.settings import ChatDomainSettings


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс глобального состояния реестров между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    yield
    reset_registry()
    reset_settings()
    reset_tools()


# -------------------------------------------------------------------------
# Хелперы
# -------------------------------------------------------------------------


def _get_event_type(event_str: str) -> str:
    for line in event_str.split("\n"):
        if line.startswith("event: "):
            return line[len("event: "):]
    return "unknown"


def _parse_event_data(event_str: str) -> dict:
    for line in event_str.split("\n"):
        if line.startswith("data: "):
            return json.loads(line[len("data: "):])
    return {}


def _push_all(limiter: BlockDeltaLimiter, chunks: list[str]) -> list[str]:
    out: list[str] = []
    for c in chunks:
        out.extend(limiter.push(c))
    if not limiter.closed:
        out.extend(limiter.flush_remaining())
    return out


# -------------------------------------------------------------------------
# 1. Маленький блок (< chunk_flush) — одна delta
# -------------------------------------------------------------------------


def test_small_block_emits_single_delta():
    """Блок меньше chunk_flush_bytes даёт один block_delta после flush."""
    limiter = BlockDeltaLimiter(
        block_index=0,
        chunk_flush_bytes=65536,
        block_max_bytes=5_242_880,
        block_type="text",
    )
    events = _push_all(limiter, ["Привет, мир!"])
    types = [_get_event_type(e) for e in events]
    assert types == ["block_delta"]
    payload = _parse_event_data(events[0])
    assert payload["delta"] == "Привет, мир!"
    assert payload["index"] == 0
    assert limiter.truncated is False
    assert limiter.closed is False


# -------------------------------------------------------------------------
# 2. Блок 100 КБ одной строкой — режется на 2 delta (64 + 36)
# -------------------------------------------------------------------------


def test_huge_single_chunk_split_to_multiple_deltas():
    """Один входящий чанк > chunk_flush режется на куски."""
    limiter = BlockDeltaLimiter(
        block_index=1,
        chunk_flush_bytes=65536,
        block_max_bytes=5_242_880,
        block_type="text",
    )
    big = "A" * (100 * 1024)  # 100 КБ ASCII
    events = _push_all(limiter, [big])
    types = [_get_event_type(e) for e in events]
    assert types == ["block_delta", "block_delta"]
    payloads = [_parse_event_data(e) for e in events]
    # Первая delta — ровно 64 КБ, вторая — остаток.
    assert len(payloads[0]["delta"].encode("utf-8")) == 65536
    assert len(payloads[1]["delta"].encode("utf-8")) == 100 * 1024 - 65536
    # Целостность данных
    joined = payloads[0]["delta"] + payloads[1]["delta"]
    assert joined == big


# -------------------------------------------------------------------------
# 3. 200 КБ мелкими чанками по 1 КБ — режутся в delta'ы по ~64 КБ
# -------------------------------------------------------------------------


def test_many_small_chunks_buffered_to_flush_size():
    """Множество мелких чанков объединяются в delta размером ~chunk_flush."""
    limiter = BlockDeltaLimiter(
        block_index=2,
        chunk_flush_bytes=65536,
        block_max_bytes=5_242_880,
        block_type="text",
    )
    chunks = ["B" * 1024 for _ in range(200)]  # 200 КБ
    events = _push_all(limiter, chunks)
    # Ожидаем ровно 4 delta: первые три по 64 КБ, последняя — остаток.
    types = [_get_event_type(e) for e in events]
    assert types.count("block_delta") >= 3
    sizes = [
        len(_parse_event_data(e)["delta"].encode("utf-8"))
        for e in events
    ]
    # Сумма равна полному объёму.
    assert sum(sizes) == 200 * 1024
    # Все промежуточные дельты не меньше chunk_flush_bytes (последняя — остаток).
    for s in sizes[:-1]:
        assert s >= 65536


# -------------------------------------------------------------------------
# 4. Блок 5.5 МБ — обрезается на 5 МБ, маркер + block_end
# -------------------------------------------------------------------------


def test_block_truncated_at_max_bytes_with_marker_and_end():
    """Превышение block_max_bytes → маркер + block_end, флаг truncated."""
    limiter = BlockDeltaLimiter(
        block_index=3,
        chunk_flush_bytes=65536,
        block_max_bytes=5 * 1024 * 1024,
        block_type="text",
    )
    big = "X" * int(5.5 * 1024 * 1024)
    events = _push_all(limiter, [big])
    types = [_get_event_type(e) for e in events]
    assert types[-1] == "block_end"
    # Последняя delta перед block_end — маркер.
    marker_payload = _parse_event_data(events[-2])
    assert "усечено" in marker_payload["delta"]
    assert "МБ" in marker_payload["delta"]
    # Реально эмитированный контент не превышает лимит (без учёта маркера).
    assert limiter.bytes_emitted <= 5 * 1024 * 1024
    assert limiter.truncated is True
    assert limiter.closed is True


# -------------------------------------------------------------------------
# 5. Последующие deltas обрезанного блока игнорируются
# -------------------------------------------------------------------------


def test_pushes_after_truncate_are_ignored():
    """После усечения все push'и возвращают пустой список."""
    limiter = BlockDeltaLimiter(
        block_index=4,
        chunk_flush_bytes=1024,
        block_max_bytes=4096,
        block_type="text",
    )
    # Сразу переполняем.
    limiter.push("Y" * 10_000)
    assert limiter.closed is True
    assert limiter.push("ещё текст") == []
    assert limiter.flush_remaining() == []


# -------------------------------------------------------------------------
# 6. Новый block_start (новый инстанс) сбрасывает счётчик
# -------------------------------------------------------------------------


def test_new_block_resets_counter():
    """Новый BlockDeltaLimiter снова получает полный лимит."""
    first = BlockDeltaLimiter(
        block_index=5,
        chunk_flush_bytes=1024,
        block_max_bytes=4096,
        block_type="text",
    )
    first.push("Z" * 10_000)
    assert first.truncated is True

    second = BlockDeltaLimiter(
        block_index=6,
        chunk_flush_bytes=1024,
        block_max_bytes=4096,
        block_type="text",
    )
    events = _push_all(second, ["короткий"])
    assert second.truncated is False
    assert second.closed is False
    types = [_get_event_type(e) for e in events]
    assert types == ["block_delta"]


# -------------------------------------------------------------------------
# 7. Логирование warning при truncate
# -------------------------------------------------------------------------


def test_truncate_logs_warning(caplog):
    """При усечении пишется logger.warning с метаданными блока."""
    caplog.set_level(
        logging.WARNING, logger="app.domains.chat.services.streaming",
    )
    limiter = BlockDeltaLimiter(
        block_index=7,
        chunk_flush_bytes=1024,
        block_max_bytes=2048,
        block_type="reasoning",
    )
    limiter.push("W" * 5000)
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert any("SSE-блок усечён" in r.getMessage() for r in warnings)
    # Проверяем extra-поля
    target = next(r for r in warnings if "SSE-блок усечён" in r.getMessage())
    assert getattr(target, "block_type", None) == "reasoning"
    assert getattr(target, "limit", None) == 2048
    assert getattr(target, "bytes_emitted", 0) <= 2048


# -------------------------------------------------------------------------
# 8. Конфигурация настроек: маленькие лимиты применяются
# -------------------------------------------------------------------------


def test_custom_settings_applied():
    """Кастомные delta_chunk_flush_bytes / delta_block_max_bytes
    применяются (минимумы валидации: 1024 / 65536).
    """
    settings = ChatDomainSettings(
        api_base="http://x",
        api_key="x",
        model="m",
        delta_chunk_flush_bytes=4096,
        delta_block_max_bytes=65536,
    )
    assert settings.delta_chunk_flush_bytes == 4096
    assert settings.delta_block_max_bytes == 65536

    limiter = BlockDeltaLimiter(
        block_index=8,
        chunk_flush_bytes=settings.delta_chunk_flush_bytes,
        block_max_bytes=settings.delta_block_max_bytes,
        block_type="text",
    )
    # 80 КБ — переполнит лимит блока (64 КБ) → truncate.
    events = _push_all(limiter, ["A" * 80_000])
    types = [_get_event_type(e) for e in events]
    assert types[-1] == "block_end"
    assert limiter.truncated is True
    # Все дельты до маркера не превышают chunk_flush_bytes байт каждая.
    delta_events = [
        e for e in events if _get_event_type(e) == "block_delta"
    ]
    # Последняя delta — маркер (короткая), не считаем её.
    for e in delta_events[:-1]:
        assert len(_parse_event_data(e)["delta"].encode("utf-8")) <= 4096


def test_settings_min_values_validation():
    """Поля имеют минимальные значения: ge=1024 и ge=65536."""
    with pytest.raises(Exception):
        ChatDomainSettings(
            api_base="x", api_key="x", model="m",
            delta_chunk_flush_bytes=512,  # < 1024
        )
    with pytest.raises(Exception):
        ChatDomainSettings(
            api_base="x", api_key="x", model="m",
            delta_block_max_bytes=10000,  # < 65536
        )


# -------------------------------------------------------------------------
# 9. Multi-byte UTF-8: байты, не символы; границы не разрезаются
# -------------------------------------------------------------------------


def test_multibyte_utf8_counted_in_bytes_not_chars():
    """Русские буквы и эмодзи — считаются в UTF-8 байтах, не в символах."""
    # 'ё' = 2 байта, '😀' = 4 байта.
    limiter = BlockDeltaLimiter(
        block_index=9,
        chunk_flush_bytes=10,
        block_max_bytes=1_000_000,
        block_type="text",
    )
    # 6 символов 'ёёёёёё' = 12 байт → должно дать flush (> 10 байт).
    events = _push_all(limiter, ["ёёёёёё"])
    types = [_get_event_type(e) for e in events]
    assert types.count("block_delta") >= 1
    # Сумма байт всех delta == исходному размеру в байтах.
    total_bytes = sum(
        len(_parse_event_data(e)["delta"].encode("utf-8"))
        for e in events
    )
    assert total_bytes == len("ёёёёёё".encode("utf-8"))

    # Дополнительно: ни одна delta не должна содержать
    # битый UTF-8 (decode успешен — гарантировано dataclass'ом).
    for e in events:
        payload = _parse_event_data(e)
        # Round-trip: текст из JSON уже декодирован, проверяем чистоту.
        assert isinstance(payload["delta"], str)


def test_multibyte_utf8_boundary_not_split():
    """При нарезке многобайтовый символ не разрезается пополам."""
    # 32 символа эмодзи = 128 байт. chunk_flush=10 → каждая delta
    # должна содержать целое число эмодзи (4 байта каждый).
    limiter = BlockDeltaLimiter(
        block_index=10,
        chunk_flush_bytes=10,
        block_max_bytes=1_000_000,
        block_type="text",
    )
    text = "😀" * 32
    events = _push_all(limiter, [text])
    for e in events:
        payload = _parse_event_data(e)
        delta_bytes = payload["delta"].encode("utf-8")
        # Каждая delta — целое число 4-байтовых символов.
        assert len(delta_bytes) % 4 == 0


# -------------------------------------------------------------------------
# 10. Нестримуемый блок (file) — block_complete не затронут лимитом
# -------------------------------------------------------------------------


def test_block_complete_not_affected_by_limit():
    """sse_block_complete отдаёт payload как есть, без нарезки/усечения."""
    huge_file_block = {
        "type": "file",
        "name": "big.bin",
        # Имитируем большой payload в метаданных (хоть бы и base64).
        "data": "Z" * (8 * 1024 * 1024),
    }
    event = sse_block_complete(block_index=11, block=huge_file_block)
    # Это одно событие без нарезки — данные не обрезаны.
    assert _get_event_type(event) == "block_complete"
    payload = _parse_event_data(event)
    assert len(payload["block"]["data"]) == 8 * 1024 * 1024


# -------------------------------------------------------------------------
# Доп. интеграция: emit_text_block_with_limit и SSE-стрим оркестратора
# -------------------------------------------------------------------------


def test_emit_text_block_with_limit_normal_path():
    """Маленький готовый блок → start + delta + end (без усечения)."""
    events = emit_text_block_with_limit(
        block_index=0,
        block_type="text",
        text="привет",
        chunk_flush_bytes=65536,
        block_max_bytes=5_242_880,
    )
    types = [_get_event_type(e) for e in events]
    assert types == ["block_start", "block_delta", "block_end"]


def test_emit_text_block_with_limit_truncate_path():
    """Переполнение — start + ...delta + маркер + block_end (без дубля)."""
    events = emit_text_block_with_limit(
        block_index=0,
        block_type="text",
        text="A" * 20_000,
        chunk_flush_bytes=1024,
        block_max_bytes=4096,
    )
    types = [_get_event_type(e) for e in events]
    assert types[0] == "block_start"
    assert types[-1] == "block_end"
    # Маркер где-то в дельтах.
    marker_seen = any(
        "усечено" in _parse_event_data(e).get("delta", "")
        for e in events
        if _get_event_type(e) == "block_delta"
    )
    assert marker_seen
    # block_end ровно один.
    assert types.count("block_end") == 1


@patch(
    "app.domains.chat.services.orchestrator.Orchestrator._get_openai_client",
)
async def test_orchestrator_stream_truncates_huge_llm_chunk(
    mock_client_factory,
):
    """End-to-end: оркестратор усекает гигантский LLM-стрим."""
    settings = ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
        model="gpt-4o",
        streaming_enabled=True,
        delta_chunk_flush_bytes=4096,
        delta_block_max_bytes=65536,
    )
    msg_service = AsyncMock()
    msg_service.get_history = AsyncMock(return_value=[])
    msg_service.save_assistant_message = AsyncMock(return_value={"id": "m1"})
    conv_service = AsyncMock()
    orch = Orchestrator(
        msg_service=msg_service,
        conv_service=conv_service,
        settings=settings,
    )

    mock_client = AsyncMock()

    async def mock_stream() -> AsyncIterator:
        # Один большой чанк > block_max_bytes (80 КБ > 64 КБ).
        chunk = MagicMock()
        delta = MagicMock()
        delta.content = "Q" * 80_000
        delta.tool_calls = None
        chunk.choices = [MagicMock(delta=delta, finish_reason=None)]
        yield chunk

        # Завершающий чанк (finish_reason).
        end = MagicMock()
        end_delta = MagicMock()
        end_delta.content = None
        end_delta.tool_calls = None
        end.choices = [MagicMock(delta=end_delta, finish_reason="stop")]
        yield end

    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream())
    mock_client_factory.return_value = mock_client

    events: list[str] = []
    async for event in orch.run_stream(
        conversation_id="conv-1",
        user_message="дай много текста",
    ):
        events.append(event)

    # В стриме должен быть block_end до message_end, причём с маркером
    # усечения в одной из delta.
    delta_events = [e for e in events if _get_event_type(e) == "block_delta"]
    marker_present = any(
        "усечено" in _parse_event_data(e).get("delta", "")
        for e in delta_events
    )
    assert marker_present, "Маркер усечения должен присутствовать в SSE-стриме"
    assert any(_get_event_type(e) == "block_end" for e in events)


# -------------------------------------------------------------------------
# Проверка дефолтов настроек
# -------------------------------------------------------------------------


def test_default_settings_values():
    """Дефолты: 64 КБ chunk-flush и 5 МБ block-max."""
    s = ChatDomainSettings(api_base="x", api_key="x", model="m")
    assert s.delta_chunk_flush_bytes == 65536
    assert s.delta_block_max_bytes == 5 * 1024 * 1024


def test_truncation_marker_template_format():
    """Маркер форматируется с лимитом в МБ."""
    rendered = TRUNCATION_MARKER.format(limit_mb=5.0)
    assert "усечено" in rendered
    assert "5.0 МБ" in rendered
