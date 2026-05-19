"""Тесты детерминированной генерации block_id для ClientActionBlock.

После Wave 2 семантика поменялась:
* В Pydantic-модели ``ClientActionBlock.block_id`` — обязательное поле
  (раньше был ``default_factory=uuid4``).
* Оркестратор переписывает ``block_id`` на детерминированный
  ``f"{message_id}:ca:{i}"`` через ``_parse_client_action_result`` —
  это гарантирует одинаковый id между запусками для frontend
  ``sessionStorage['chat:executedActions']``-дедупликации.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pydantic
import pytest

from app.core.chat.blocks import ClientActionBlock
from app.domains.chat.services.orchestrator import Orchestrator
from app.domains.chat.settings import ChatDomainSettings


def _orch() -> Orchestrator:
    return Orchestrator(
        msg_service=AsyncMock(),
        conv_service=AsyncMock(),
        settings=ChatDomainSettings(),
    )


def test_block_id_required_in_pydantic_model():
    """ClientActionBlock без block_id → ValidationError."""
    with pytest.raises(pydantic.ValidationError) as exc_info:
        ClientActionBlock(action="notify", params={"message": "x"})
    # Конкретное поле — block_id
    errors = exc_info.value.errors()
    assert any(
        e["loc"] == ("block_id",) and e["type"] == "missing"
        for e in errors
    )


def test_orchestrator_assigns_deterministic_id():
    """3 client_action в одном ответе → id: msg-1:ca:0, :ca:1, :ca:2."""
    orch = _orch()
    counter = [0]
    ids = []
    for _ in range(3):
        raw = json.dumps({
            "type": "client_action",
            "action": "notify",
            "params": {"message": "x"},
        })
        parsed = orch._parse_client_action_result(
            raw, message_id="msg-1", ca_counter=counter,
        )
        ids.append(parsed["block_id"])
    assert ids == ["msg-1:ca:0", "msg-1:ca:1", "msg-1:ca:2"]


def test_repeated_parse_with_same_counter_state_yields_same_ids():
    """Повторный парсинг с тем же стартовым counter даёт те же id (детерминизм)."""
    orch = _orch()
    raw = json.dumps({
        "type": "client_action",
        "action": "open_url",
        "params": {"url": "https://example.com"},
    })

    # Прогон 1
    counter1 = [0]
    a1 = orch._parse_client_action_result(raw, message_id="m", ca_counter=counter1)
    a2 = orch._parse_client_action_result(raw, message_id="m", ca_counter=counter1)
    # Прогон 2 (новая сессия — тот же msg_id, тот же стартовый counter)
    counter2 = [0]
    b1 = orch._parse_client_action_result(raw, message_id="m", ca_counter=counter2)
    b2 = orch._parse_client_action_result(raw, message_id="m", ca_counter=counter2)

    assert a1["block_id"] == b1["block_id"] == "m:ca:0"
    assert a2["block_id"] == b2["block_id"] == "m:ca:1"


def test_different_message_ids_produce_different_block_ids():
    """ID привязан к message_id — разные сообщения → разные id."""
    orch = _orch()
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "x"},
    })
    a = orch._parse_client_action_result(raw, message_id="m-A", ca_counter=[0])
    b = orch._parse_client_action_result(raw, message_id="m-B", ca_counter=[0])
    assert a["block_id"] == "m-A:ca:0"
    assert b["block_id"] == "m-B:ca:0"
    assert a["block_id"] != b["block_id"]


def test_handler_supplied_block_id_is_overwritten():
    """Wave 2: даже если handler выставил свой block_id — оркестратор
    переписывает его на детерминированный (см. orchestrator.py:798-819)."""
    orch = _orch()
    raw = json.dumps({
        "type": "client_action",
        "action": "notify",
        "params": {"message": "x"},
        "block_id": "handler-provided-uuid-1234",
    })
    parsed = orch._parse_client_action_result(
        raw, message_id="m", ca_counter=[5],
    )
    assert parsed["block_id"] == "m:ca:5"


def test_run_accepts_message_id_and_uses_it_for_save():
    """run() (non-streaming) обязан принимать message_id и пробрасывать его
    в ``_save_assistant_message`` — id блок-структуры в БД совпадает с id,
    использованным для построения ClientActionBlock.block_id.

    До этого фикса run() генерил собственный uuid внутри метода: фронт после
    reload видел в БД «новый» message_id, не совпадающий с тем, что был в
    ``sessionStorage['chat:executedActions']`` ⇒ повторное исполнение action.
    """
    import inspect

    sig = inspect.signature(Orchestrator.run)
    assert "message_id" in sig.parameters, (
        "Orchestrator.run() должен принимать message_id для согласования "
        "с frontend dedup'ом client_action-блоков"
    )
    # message_id обязателен (без default) — API-эндпоинт генерирует id и
    # пробрасывает его, fallback внутри run() убран.
    assert sig.parameters["message_id"].default is inspect.Parameter.empty
