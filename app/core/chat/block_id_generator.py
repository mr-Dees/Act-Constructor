"""Детерминированный генератор block_id для всех источников блоков.

Один экземпляр на ``message_id`` хранит per-type счётчики и гарантирует
уникальность id внутри сообщения независимо от источника эмиссии
(streaming, finalize, ``agent_bridge_runner``).

Раньше ``block_id`` генерился в трёх независимых местах:
``orchestrator._parse_client_action_result``,
``block_emitter.emit_response_blocks`` и ``agent_bridge_runner._run`` —
каждое со своим счётчиком, формат частично совпадал. При определённом
порядке эмиссии (streaming сначала эмитит client_action с idx=0, потом
``emit_response_blocks`` финализирует и тоже эмитит client_action с
idx=0) фронт получал два блока с одним ``block_id`` и дедупил второй
через ``sessionStorage['chat:executedActions']`` — действие терялось.
"""

from __future__ import annotations

import threading

# Типы блоков, для которых используются автогенерированные счётчики
# (а не seq из ``agent_response_events`` для forward'а).
_COUNTER_TYPES = frozenset({
    "text", "code", "reasoning", "client_action", "error",
    "file", "image", "plan", "buttons",
})


class BlockIdGenerator:
    """Per-message генератор детерминированных ``block_id``.

    Использование::

        gen = BlockIdGenerator(message_id="msg-uuid")
        gen.next("client_action")  # → "msg-uuid:client_action:0"
        gen.next("client_action")  # → "msg-uuid:client_action:1"
        gen.next("text")           # → "msg-uuid:text:0" (счётчик per-type)

    Опциональный seed для ``agent_bridge_runner`` (использует ``seq``
    события из ``agent_response_events``)::

        gen.with_seq("reasoning", seq=42)  # → "msg-uuid:reasoning:42"

    ``with_seq`` НЕ инкрементит внутренний счётчик: ``seq`` уже
    глобально уникален в рамках request_id (генерируется БД), отдельный
    счётчик с ним конфликтовать не должен.
    """

    def __init__(self, message_id: str) -> None:
        if not message_id:
            raise ValueError("message_id обязателен")
        self._message_id = message_id
        self._counters: dict[str, int] = {}
        # Lock на случай параллельной эмиссии. На текущий момент
        # ``stream_loop`` и ``block_emitter`` крутятся в одной короутине,
        # но генератор может быть передан в фоновую задачу — defensive
        # синхронизация дешёвая, ошибка нумерации дорогая.
        self._lock = threading.Lock()

    @property
    def message_id(self) -> str:
        return self._message_id

    def next(self, block_type: str) -> str:
        """Очередной id для типа. Счётчик per-type, начинается с 0."""
        with self._lock:
            i = self._counters.get(block_type, 0)
            self._counters[block_type] = i + 1
            return f"{self._message_id}:{block_type}:{i}"

    def with_seq(self, block_type: str, seq: int) -> str:
        """ID с явным ``seq`` (для ``agent_bridge_runner``: seq берётся из
        ``agent_response_events``). НЕ инкрементит счётчик.
        """
        return f"{self._message_id}:{block_type}:{seq}"
