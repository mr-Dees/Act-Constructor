"""Фича «Корректор»: обработка выделенного текста LLM в двух режимах (one-shot).

``fix`` — орфография/пунктуация (дословный промпт D17 ``AUDITOR_SYSTEM_PROMPT``),
``readability`` — улучшение читаемости/структуры (базовый ``READABILITY_SYSTEM_PROMPT``,
доработка D17). Перенос наработки D17 (папка 1) на нативную LLM-инфру домена чата:
``build_llm_client`` + ``retry_on_transient`` вместо vLLM/LangChain; логика вызова —
одно синхронное обращение к модели, промпт/температура выбираются по режиму.
"""

from typing import Literal

from app.domains.chat.exceptions import TextActionValidationError
from app.domains.chat.services.llm_client import build_llm_client
from app.domains.chat.services.retry import retry_on_transient
from app.domains.chat.services.text_actions.llm_utils import run_text_call
from app.domains.chat.services.text_actions.prompts import (
    AUDITOR_SYSTEM_PROMPT,
    READABILITY_SYSTEM_PROMPT,
)
from app.domains.chat.settings import ChatDomainSettings

CorrectMode = Literal["fix", "readability"]


class TextCorrectorService:
    """Прогоняет выделенный текст через LLM в выбранном режиме (``fix``/``readability``)."""

    def __init__(self, settings: ChatDomainSettings) -> None:
        self._settings = settings
        ta = settings.text_actions
        # None → основная модель профиля чата.
        self._model = ta.corrector_model or settings.model
        self._timeout = ta.per_call_timeout_sec
        self._max_chars = ta.max_input_chars
        # Промпт и температура — по режиму.
        self._prompts = {
            "fix": AUDITOR_SYSTEM_PROMPT,
            "readability": READABILITY_SYSTEM_PROMPT,
        }
        self._temperatures = {
            "fix": ta.corrector_temperature,
            "readability": ta.readability_temperature,
        }
        r = settings.retry
        self._retry_call = retry_on_transient(
            on_429=r.on_429,
            on_5xx=r.on_5xx,
            max_attempts=r.max_attempts,
            connect_max_attempts=r.connect_max_attempts,
            backoff_base=r.backoff_base_sec,
        )

    async def correct(self, text: str, mode: CorrectMode = "fix") -> str:
        """Вернуть обработанный текст в режиме ``mode``. Кидает
        ``TextActionValidationError`` на неизвестный режим, пустой/слишком
        длинный ввод."""
        if mode not in self._prompts:
            raise TextActionValidationError(f"Неизвестный режим корректора: {mode}")
        if not text or not text.strip():
            raise TextActionValidationError("Пустой текст для корректуры")
        if len(text) > self._max_chars:
            raise TextActionValidationError(
                f"Текст длиннее {self._max_chars} символов — сократите выделение",
            )
        client = build_llm_client(self._settings)
        return await run_text_call(
            client,
            model=self._model,
            temperature=self._temperatures[mode],
            system=self._prompts[mode],
            user=text,
            retry_call=self._retry_call,
            timeout=self._timeout,
        )
