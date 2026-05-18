"""Тесты системы логирования: формат вывода и инжекция request_id."""

from __future__ import annotations

import io
import json
import logging

import pytest

from app.core.logging import (
    RequestIdFilter,
    _make_json_formatter,
    _make_text_formatter,
    request_id_var,
)


@pytest.fixture
def _reset_request_id():
    """Сбрасывает request_id_var в "-" после каждого теста."""
    token = request_id_var.set("-")
    yield
    request_id_var.reset(token)


def _emit_record(formatter: logging.Formatter, message: str) -> str:
    """Эмитит одну запись через handler с указанным форматтером и
    возвращает выведенную строку."""
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(formatter)
    handler.addFilter(RequestIdFilter())

    logger = logging.getLogger(f"test.logging.{id(stream)}")
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    logger.propagate = False

    logger.info(message)

    handler.flush()
    return stream.getvalue().strip()


def test_json_formatter_produces_valid_json(_reset_request_id):
    """JSON-форматтер выдаёт валидный JSON с обязательными полями."""
    formatter = _make_json_formatter()
    output = _emit_record(formatter, "test message")
    parsed = json.loads(output)
    assert parsed["message"] == "test message"
    assert parsed["level"] == "INFO"
    assert "timestamp" in parsed
    assert "name" in parsed
    assert "request_id" in parsed


def test_json_formatter_contains_request_id_from_context(_reset_request_id):
    """request_id_var.set(...) → значение попадает в JSON-лог."""
    request_id_var.set("abc-123")
    formatter = _make_json_formatter()
    output = _emit_record(formatter, "with request id")
    parsed = json.loads(output)
    assert parsed["request_id"] == "abc-123"


def test_json_formatter_default_request_id_is_dash(_reset_request_id):
    """Вне HTTP-контекста request_id = '-'."""
    formatter = _make_json_formatter()
    output = _emit_record(formatter, "no request id")
    parsed = json.loads(output)
    assert parsed["request_id"] == "-"


def test_json_formatter_includes_extra_fields(_reset_request_id):
    """Поля, переданные через extra={...}, попадают в JSON как ключи."""
    formatter = _make_json_formatter()
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(formatter)
    handler.addFilter(RequestIdFilter())

    logger = logging.getLogger("test.logging.extra")
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    logger.propagate = False

    logger.warning("LLM timeout", extra={"stage": "run", "elapsed_sec": 30.5})
    handler.flush()

    parsed = json.loads(stream.getvalue().strip())
    assert parsed["message"] == "LLM timeout"
    assert parsed["stage"] == "run"
    assert parsed["elapsed_sec"] == 30.5


def test_text_formatter_is_not_json(_reset_request_id):
    """Текстовый формат сохраняет человекочитаемый вид (не JSON)."""
    formatter = _make_text_formatter()
    output = _emit_record(formatter, "human readable")

    with pytest.raises(json.JSONDecodeError):
        json.loads(output)

    assert "INFO" in output
    assert "human readable" in output
    # request_id выводится в квадратных скобках
    assert "[-]" in output


def test_text_formatter_includes_request_id(_reset_request_id):
    """Текстовый формат подставляет request_id из контекста."""
    request_id_var.set("xyz-999")
    formatter = _make_text_formatter()
    output = _emit_record(formatter, "with id")
    assert "[xyz-999]" in output
