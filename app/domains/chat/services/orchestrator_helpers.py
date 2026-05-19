"""Хелперы оркестратора чата.

Module-level функции и константы, общие для всех веток ``Orchestrator``
(run / run_stream / non-streaming GigaChat / forward bridge). Жили в
``orchestrator.py`` — вынесены сюда, чтобы:

* уменьшить размер оркестратора (~2.4 тыс. строк → ~2.1 тыс.);
* собрать в одном месте «защитные» преобразования, которые читаются
  одинаково в трёх зеркальных ветках (``_safe_args``, ``_convert_param``);
* системные промпты и нейтральные текстовые шаблоны не путались с
  бизнес-логикой потоков.

Любой импорт из ``orchestrator.py`` должен делать ``from .orchestrator_helpers
import ...`` — это единственный публичный путь.
"""

from __future__ import annotations

from datetime import date
from typing import Any


# Нейтральное сообщение для tool-результата при ChatToolValidationError —
# попадает в messages[], НЕ показывается пользователю напрямую.
TOOL_VALIDATION_NEUTRAL_MESSAGE = (
    "Не удалось выполнить инструмент. Попробуйте переформулировать запрос."
)


# Базовый system-prompt оркестратора. Дописывается per-domain-промптами в
# ``Orchestrator._build_system_messages``.
BASE_SYSTEM_PROMPT = (
    "Ты — ассистент в AuditWorkstation.\n\n"
    "ВАЖНОЕ ПРАВИЛО ПРИОРИТЕТА:\n"
    "По умолчанию любые вопросы пользователя про данные, контент, акты, "
    "нормативы, регламенты, фактуры, нарушения, метрики, реестры — "
    "передавай через chat.forward_to_knowledge_agent. Внешний агент сам "
    "найдёт информацию.\n\n"
    "Локальные action-tools (open_*, navigate_*, notify, ...) — вызывай "
    "ТОЛЬКО когда пользователь явно просит что-то сделать в интерфейсе "
    "(\"открой\", \"создай\", \"перейди\", \"покажи на странице\").\n\n"
    "Не сочиняй данные из БЗ — всегда передавай вопрос внешнему агенту."
)


def safe_args(raw: Any) -> str:
    """Возвращает arguments tool_call'а как непустую JSON-строку.

    SDK и streaming-аккумулятор отдают ``arguments=""`` для вызовов без
    параметров (LLM не эмитит delta аргументов). При эхо такой пустой
    строки в следующий LLM-вызов:

    * Qwen/SGLang chat-template: ``json.loads("")`` → 400 «zero-length
      empty doc».
    * GigaChat-proxy: 422 ``RequestInputValidationException``.

    Возвращаем ``"{}"`` — корректный пустой JSON-объект.
    """
    if isinstance(raw, str) and raw:
        return raw
    return "{}"


def convert_param(value: Any, param_type: str) -> Any:
    """Конвертация значения параметра из JSON в Python-тип."""
    if value is None:
        return None
    if param_type == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1")
    if param_type == "integer":
        return int(value)
    if param_type == "date":
        if isinstance(value, str):
            return date.fromisoformat(value)
        return value
    if param_type == "string":
        return str(value)
    return value
