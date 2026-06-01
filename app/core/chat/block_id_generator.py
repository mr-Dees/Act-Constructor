"""Детерминированный генератор block_id для всех источников блоков.

Один экземпляр на ``message_id`` хранит per-type счётчики и гарантирует
уникальность id внутри сообщения независимо от источника эмиссии
(streaming, finalize, поллер канала к внешнему агенту).

Раньше ``block_id`` генерился в нескольких независимых местах со своими
счётчиками; формат частично совпадал, и при определённом порядке эмиссии
фронт получал два блока с одним ``block_id`` и дедупил второй через
``sessionStorage['chat:executedActions']`` — действие терялось.
"""

from __future__ import annotations

import threading

# Типы блоков, для которых используются автогенерированные счётчики
# (а не внешний seq).
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

    Опциональный seed с внешним ``seq``::

        gen.with_seq("reasoning", seq=42)  # → "msg-uuid:reasoning:42"

    ``with_seq`` НЕ инкрементит внутренний счётчик: ``seq`` уже глобально
    уникален, отдельный счётчик с ним конфликтовать не должен.
    """

    def __init__(self, message_id: str) -> None:
        if not message_id:
            raise ValueError("message_id обязателен")
        self._message_id = message_id
        self._counters: dict[str, int] = {}
        # Lock на случай параллельной эмиссии: генератор может быть передан
        # в фоновую задачу — defensive синхронизация дешёвая, ошибка
        # нумерации дорогая.
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
        """ID с явным внешним ``seq``. НЕ инкрементит счётчик."""
        return f"{self._message_id}:{block_type}:{seq}"
