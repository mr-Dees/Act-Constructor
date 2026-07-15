"""Тесты нативных LLM-хелперов text-actions."""

from unittest.mock import AsyncMock

from app.domains.chat.services.text_actions import llm_utils as U


def test_strip_think_removes_reasoning():
    raw = "<think>рассуждаю тут\nи тут</think>\nИсправленный текст."
    assert U.strip_think(raw).strip() == "Исправленный текст."


def test_strip_think_noop_on_plain_text():
    assert U.strip_think("обычный текст") == "обычный текст"


def test_clean_text_response_strips_leading_preamble_label():
    # Anthropic вопреки запрету добавил ярлык отдельной строкой — срезаем.
    raw = "Исправленный текст:\n\nВ ходе проверки выявлено нарушение."
    assert U.clean_text_response(raw) == "В ходе проверки выявлено нарушение."


def test_clean_text_response_strips_readability_preamble():
    raw = "Вот улучшенный вариант:\nТекст стал яснее."
    assert U.clean_text_response(raw) == "Текст стал яснее."


def test_clean_text_response_unwraps_code_fence():
    raw = "```\nисправленный абзац\n```"
    assert U.clean_text_response(raw) == "исправленный абзац"


def test_clean_text_response_strips_think_and_preamble_together():
    raw = "<think>подумаю</think>\nИсправленный текст:\nГотово."
    assert U.clean_text_response(raw) == "Готово."


def test_clean_text_response_keeps_inline_label_as_real_content():
    # Ярлык БЕЗ перевода строки — это реальный текст (не преамбула), не трогаем.
    raw = "Исправленный текст: смотри приложение №3."
    assert U.clean_text_response(raw) == "Исправленный текст: смотри приложение №3."


def test_clean_text_response_noop_on_clean_text():
    assert U.clean_text_response("В акте установлено нарушение.") == "В акте установлено нарушение."


async def test_run_text_call_returns_content_and_passes_params():
    client = AsyncMock()
    msg = AsyncMock()
    msg.content = "<think>ага</think>исправлено"
    resp = AsyncMock()
    resp.choices = [AsyncMock(message=msg)]
    client.chat.completions.create = AsyncMock(return_value=resp)

    out = await U.run_text_call(
        client, model="m", temperature=0.1, system="s", user="u",
        retry_call=lambda f: f, timeout=5.0,
    )
    assert out == "исправлено"
    kwargs = client.chat.completions.create.call_args.kwargs
    assert kwargs["temperature"] == 0.1
    assert kwargs["stream"] is False
    assert kwargs["timeout"] == 5.0
    assert kwargs["messages"][0] == {"role": "system", "content": "s"}
    assert kwargs["messages"][1] == {"role": "user", "content": "u"}
