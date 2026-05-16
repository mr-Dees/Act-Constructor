"""Универсальный аккумулятор tool-calls в стриме.

Покрывает quirks разных провайдеров:
  - SGLang Llama-3.x: index в delta может быть None — fallback на последний виденный
  - MiniMax M2: reasoning_details приходит отдельным полем delta — собирается отдельно
  - OpenRouter / OpenAI: стандартное поведение
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterator

StreamEvent = tuple[str, Any]  # ("content", str) — единственный текущий тип


@dataclass
class ToolCall:
    """Готовый tool-call после сборки из стрима."""
    id: str
    name: str
    arguments: str  # JSON-строка (как в OpenAI tools API)


@dataclass
class _Slot:
    id: str = ""
    name: str = ""
    arguments: str = ""


class ToolCallAccumulator:
    """Собирает tool-calls и reasoning_details из delta-чанков."""

    def __init__(self) -> None:
        self._slots: dict[int, _Slot] = {}
        self._next_fallback_index: int = 0
        self._last_seen_index: int | None = None
        self._reasoning_details: list[dict] = []

    @property
    def reasoning_details(self) -> list[dict]:
        """Возвращает копию накопленных reasoning-фрагментов."""
        return list(self._reasoning_details)

    def consume(self, chunk: Any) -> Iterator[StreamEvent]:
        """Принимает delta-чанк, yield-ит ('content', str) события."""
        choices = getattr(chunk, "choices", None) or []
        if not choices:
            return
        delta = choices[0].delta

        content = getattr(delta, "content", None)
        if content:
            yield ("content", content)

        rd = getattr(delta, "reasoning_details", None)
        if rd:
            self._reasoning_details.extend(rd)

        for tc in (getattr(delta, "tool_calls", None) or []):
            idx = self._resolve_index(tc.index)
            slot = self._slots.setdefault(idx, _Slot())
            if getattr(tc, "id", None):
                slot.id = tc.id
            fn = getattr(tc, "function", None)
            if fn is not None:
                if getattr(fn, "name", None):
                    slot.name = fn.name
                if getattr(fn, "arguments", None):
                    slot.arguments += fn.arguments

    def _resolve_index(self, index: int | None) -> int:
        """SGLang-fallback: использовать последний виденный index, если None."""
        if index is not None:
            self._last_seen_index = index
            return index
        if self._last_seen_index is not None:
            return self._last_seen_index
        # Самый первый чанк с index=None — назначим 0
        idx = self._next_fallback_index
        self._next_fallback_index += 1
        self._last_seen_index = idx
        return idx

    def finalize(self) -> list[ToolCall]:
        """Возвращает собранные tool-calls в порядке индекса."""
        return [
            ToolCall(id=s.id, name=s.name, arguments=s.arguments)
            for _, s in sorted(self._slots.items(), key=lambda kv: kv[0])
        ]
