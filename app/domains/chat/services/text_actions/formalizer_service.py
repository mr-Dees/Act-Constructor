"""Фича «Формализация нарушения»: раскладка свободного текста по полям карточки.

4 экстрактора D17 (``formalizer_prompts``) читают один и тот же текст параллельно
(``asyncio.gather``); результаты складываются в поля нарушения проекта
(established/violated/reasons/measures/responsible/consequences — «Принятые меры»
раскладываются в поле карточки под «Причинами»). Структуру JSON получаем
провайдер-агностично (промпт → JSON → разбор), БЕЗ ``response_format``.

Отказ отдельного экстрактора не роняет формализацию: поле просто останется пустым
(«что LLM выделила — заполняем, что не смогла — пусто»).
"""

import asyncio
import logging

from pydantic import BaseModel, Field

from app.domains.chat.exceptions import TextActionValidationError
from app.domains.chat.schemas.text_actions import FormalizeResponse
from app.domains.chat.services.llm_client import build_llm_client
from app.domains.chat.services.retry import retry_on_transient
from app.domains.chat.services.text_actions.formalizer_prompts import (
    CAUSES_SYSTEM,
    CONSEQUENCES_SYSTEM,
    ESSENCE_SYSTEM,
    MEASURES_SYSTEM,
)
from app.domains.chat.services.text_actions.llm_utils import run_json_call
from app.domains.chat.settings import ChatDomainSettings

logger = logging.getLogger(__name__)


# --- Разобранный вывод экстракторов D17 (зеркало schema.py; поля с дефолтами
#     ради устойчивости к частичному ответу модели: недостающий ключ → пусто) ---

class EssenceParsed(BaseModel):
    essence: str = ""
    norm_doc: str = ""
    metrics: list[str] = Field(default_factory=list)


class CausesParsed(BaseModel):
    causes: list[str] = Field(default_factory=list)
    persons: list[str] = Field(default_factory=list)


class ConsequencesParsed(BaseModel):
    consequences: str = ""


class MeasuresParsed(BaseModel):
    measures: list[str] = Field(default_factory=list)


def _join(items: list[str]) -> str:
    """Список D17 → строка поля нарушения: непустые элементы через «; »."""
    return "; ".join(s.strip() for s in items if s and s.strip())


def _established_from(essence: EssenceParsed) -> str:
    """«Установлено» = суть + метрики (каждый факт с новой строки)."""
    parts: list[str] = []
    if essence.essence.strip():
        parts.append(essence.essence.strip())
    parts.extend(m.strip() for m in essence.metrics if m and m.strip())
    return "\n".join(parts)


class ViolationFormalizerService:
    """Раскладывает свободный текст нарушения по полям карточки (4 экстрактора D17)."""

    def __init__(self, settings: ChatDomainSettings) -> None:
        self._settings = settings
        ta = settings.text_actions
        # None → основная модель профиля чата.
        self._model = ta.formalizer_model or settings.model
        self._temperature = ta.formalizer_temperature
        self._timeout = ta.per_call_timeout_sec
        self._max_chars = ta.max_input_chars
        r = settings.retry
        self._retry_call = retry_on_transient(
            on_429=r.on_429,
            on_5xx=r.on_5xx,
            max_attempts=r.max_attempts,
            connect_max_attempts=r.connect_max_attempts,
            backoff_base=r.backoff_base_sec,
        )

    async def formalize(self, text: str) -> FormalizeResponse:
        """Разложить текст по полям карточки. Кидает ``TextActionValidationError``
        на пустой/слишком длинный ввод. Сбой отдельного экстрактора → пустое поле."""
        if not text or not text.strip():
            raise TextActionValidationError("Пустой текст для формализации")
        if len(text) > self._max_chars:
            raise TextActionValidationError(
                f"Текст длиннее {self._max_chars} символов — сократите выделение",
            )
        client = build_llm_client(self._settings)
        essence, causes, consequences, measures = await asyncio.gather(
            self._extract(client, EssenceParsed, ESSENCE_SYSTEM, text),
            self._extract(client, CausesParsed, CAUSES_SYSTEM, text),
            self._extract(client, ConsequencesParsed, CONSEQUENCES_SYSTEM, text),
            self._extract(client, MeasuresParsed, MEASURES_SYSTEM, text),
        )
        return FormalizeResponse(
            violated=essence.norm_doc.strip(),
            established=_established_from(essence),
            reasons=_join(causes.causes),
            responsible=_join(causes.persons),
            consequences=consequences.consequences.strip(),
            measures=_join(measures.measures),
        )

    async def _extract(self, client, schema_cls, system: str, text: str):
        """Один экстрактор: JSON-вызов + валидация. Любой сбой → пустой результат
        (частичная толерантность — поле карточки останется пустым)."""
        try:
            raw = await run_json_call(
                client,
                model=self._model,
                temperature=self._temperature,
                system=system,
                user=text,
                retry_call=self._retry_call,
                timeout=self._timeout,
            )
            return schema_cls.model_validate(raw)
        except Exception as e:  # noqa: BLE001 — сбой экстрактора не роняет формализацию
            logger.warning(
                "Экстрактор %s не дал результата: %s", schema_cls.__name__, e,
            )
            return schema_cls()
