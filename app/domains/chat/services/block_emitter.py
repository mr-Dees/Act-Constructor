"""SSE-эмиттер блоков ответа агента (для live-стрима и resume).

Унифицирует правила маршрутизации блоков:
  - text/code/reasoning → триплет block_start + block_delta + block_end
  - file/image/plan/error → одно событие block_complete
  - buttons → sse_buttons (с трансляцией через button_translator)
  - client_action → sse_client_action (исполняется фронтом один раз)

ВАЖНО: ClientActionBlock эмитится ТОЛЬКО через sse_client_action.
Не эмитить триплетом — иначе фронт исполнит действие дважды или не сможет
рендерить чип в истории.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

# Стримуемые блоки: фронт собирает их инкрементально из дельт.
# Все прочие нестримуемые типы (file, image, plan, error, …) уходят
# одним сообщением через block_complete с полным payload — иначе фронт
# увидит пустой текстовый контейнер.
STREAMABLE_BLOCK_TYPES = ("text", "code", "reasoning")


async def emit_response_blocks(
    blocks: list[dict],
    *,
    block_index_start: int = 0,
) -> AsyncIterator[tuple[str, int]]:
    """Async-генератор SSE-строк для финальных блоков ответа агента.

    Yield-ит пары ``(sse_string, next_block_index)``: после каждой
    итерации ``next_block_index`` — индекс, который должен быть
    использован для следующего блока вне этого вызова. Buttons и
    client_action идут по собственным SSE-каналам и block_index НЕ
    инкрементируют.
    """
    from app.domains.chat.services.button_translator import translate_buttons
    from app.domains.chat.services.streaming import (
        sse_block_complete,
        sse_block_delta,
        sse_block_end,
        sse_block_start,
        sse_buttons,
        sse_client_action,
    )

    idx = block_index_start
    for raw_block in blocks:
        btype = raw_block.get("type", "text")
        if btype == "buttons":
            translated = await translate_buttons(raw_block.get("buttons") or [])
            yield sse_buttons(buttons=translated), idx
            continue
        if btype == "client_action":
            yield sse_client_action(block=raw_block), idx
            continue
        if btype in STREAMABLE_BLOCK_TYPES:
            yield sse_block_start(block_index=idx, block_type=btype), idx
            delta = raw_block.get("content", "")
            if delta:
                yield sse_block_delta(block_index=idx, delta=delta), idx
            yield sse_block_end(block_index=idx), idx
        else:
            yield sse_block_complete(block_index=idx, block=raw_block), idx
        idx += 1
