"""Тесты TextCorrectorService (Фича «Корректор»)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.domains.chat.exceptions import TextActionValidationError
from app.domains.chat.services.text_actions.corrector_service import (
    TextCorrectorService,
)
from app.domains.chat.settings import ChatDomainSettings


def _settings():
    return ChatDomainSettings(api_base="http://x", api_key="x", model="m")


async def test_correct_calls_llm_with_corrector_prompt():
    fake = AsyncMock()
    msg = AsyncMock()
    msg.content = "исправлено"
    resp = AsyncMock()
    resp.choices = [AsyncMock(message=msg)]
    fake.chat.completions.create = AsyncMock(return_value=resp)

    with patch(
        "app.domains.chat.services.text_actions.corrector_service.build_llm_client",
        return_value=fake,
    ):
        out = await TextCorrectorService(_settings()).correct("исходый тект")

    assert out == "исправлено"
    kwargs = fake.chat.completions.create.call_args.kwargs
    assert kwargs["temperature"] == 0.1  # корректорская температура
    assert "корректор" in kwargs["messages"][0]["content"]
    assert kwargs["messages"][1]["content"] == "исходый тект"


async def test_correct_readability_mode_uses_readability_prompt():
    fake = AsyncMock()
    msg = AsyncMock()
    msg.content = "улучшено"
    resp = AsyncMock()
    resp.choices = [AsyncMock(message=msg)]
    fake.chat.completions.create = AsyncMock(return_value=resp)

    with patch(
        "app.domains.chat.services.text_actions.corrector_service.build_llm_client",
        return_value=fake,
    ):
        out = await TextCorrectorService(_settings()).correct("текст", mode="readability")

    assert out == "улучшено"
    kwargs = fake.chat.completions.create.call_args.kwargs
    assert kwargs["temperature"] == 0.3  # температура режима читаемости
    system = kwargs["messages"][0]["content"].lower()
    assert "читаемость" in system  # промпт улучшения читаемости, не корректорский
    assert "корректор банковских документов" not in system


async def test_correct_rejects_unknown_mode():
    with pytest.raises(TextActionValidationError):
        await TextCorrectorService(_settings()).correct("текст", mode="bogus")


async def test_correct_rejects_empty():
    with pytest.raises(TextActionValidationError):
        await TextCorrectorService(_settings()).correct("   ")


async def test_correct_rejects_too_long():
    s = _settings()
    s.text_actions.max_input_chars = 5
    with pytest.raises(TextActionValidationError):
        await TextCorrectorService(s).correct("слишком длинный текст")
