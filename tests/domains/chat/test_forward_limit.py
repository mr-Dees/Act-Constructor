"""Тесты per-user счётчика активных forward'ов."""
from __future__ import annotations

import pytest

from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.services import forward_limit


@pytest.fixture(autouse=True)
def _reset_forward_limit():
    forward_limit.reset()
    yield
    forward_limit.reset()


def test_check_and_acquire_under_limit():
    forward_limit.check_and_acquire("u1", limit=3)
    assert forward_limit.get_count("u1") == 1
    forward_limit.check_and_acquire("u1", limit=3)
    assert forward_limit.get_count("u1") == 2


def test_check_and_acquire_at_limit_raises():
    for _ in range(3):
        forward_limit.check_and_acquire("u1", limit=3)
    with pytest.raises(ChatLimitError) as exc_info:
        forward_limit.check_and_acquire("u1", limit=3)
    assert "3" in str(exc_info.value)
    # Счётчик не вырос при отказе.
    assert forward_limit.get_count("u1") == 3


def test_release_decrements():
    forward_limit.check_and_acquire("u1", limit=3)
    forward_limit.check_and_acquire("u1", limit=3)
    forward_limit.release("u1")
    assert forward_limit.get_count("u1") == 1


def test_release_below_zero_clamped():
    forward_limit.release("u_unknown")
    assert forward_limit.get_count("u_unknown") == 0
    forward_limit.release("u_unknown")
    assert forward_limit.get_count("u_unknown") == 0


def test_reset_clears():
    forward_limit.check_and_acquire("u1", limit=3)
    forward_limit.check_and_acquire("u2", limit=3)
    forward_limit.reset()
    assert forward_limit.get_count("u1") == 0
    assert forward_limit.get_count("u2") == 0


def test_acquire_no_check_bypasses_limit():
    """Reconcile-инкремент не должен бросать даже при превышении лимита."""
    for _ in range(5):
        forward_limit.acquire_no_check("u1")
    assert forward_limit.get_count("u1") == 5


def test_counters_are_per_user():
    forward_limit.check_and_acquire("u1", limit=3)
    forward_limit.check_and_acquire("u2", limit=3)
    forward_limit.check_and_acquire("u2", limit=3)
    assert forward_limit.get_count("u1") == 1
    assert forward_limit.get_count("u2") == 2
