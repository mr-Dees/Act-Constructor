"""Тесты ``BlockIdGenerator`` — детерминированной нумерации блоков."""

from __future__ import annotations

import pytest

from app.core.chat.block_id_generator import BlockIdGenerator


def test_next_unique_for_same_type():
    """100 последовательных next() для одного типа — все id уникальны."""
    gen = BlockIdGenerator(message_id="msg-1")
    ids = {gen.next("client_action") for _ in range(100)}
    assert len(ids) == 100
    assert "msg-1:client_action:0" in ids
    assert "msg-1:client_action:99" in ids


def test_counters_are_independent_per_type():
    """Счётчики разных типов независимы — оба начинаются с 0."""
    gen = BlockIdGenerator(message_id="msg-x")
    assert gen.next("text") == "msg-x:text:0"
    assert gen.next("text") == "msg-x:text:1"
    assert gen.next("client_action") == "msg-x:client_action:0"
    assert gen.next("reasoning") == "msg-x:reasoning:0"
    assert gen.next("client_action") == "msg-x:client_action:1"


def test_with_seq_does_not_increment_counter():
    """``with_seq`` использует переданный seq и не трогает счётчик ``next``."""
    gen = BlockIdGenerator(message_id="msg-2")
    assert gen.with_seq("reasoning", seq=7) == "msg-2:reasoning:7"
    assert gen.with_seq("reasoning", seq=42) == "msg-2:reasoning:42"
    # next() стартует с 0 (with_seq не повлиял на счётчик)
    assert gen.next("reasoning") == "msg-2:reasoning:0"


def test_empty_message_id_raises():
    """Пустой message_id отвергается на этапе конструктора."""
    with pytest.raises(ValueError, match="message_id"):
        BlockIdGenerator(message_id="")


def test_message_id_property():
    """``message_id`` доступен через свойство."""
    gen = BlockIdGenerator(message_id="msg-3")
    assert gen.message_id == "msg-3"
