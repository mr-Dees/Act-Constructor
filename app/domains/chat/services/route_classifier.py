"""Классификатор маршрута и исхода ответа ассистента.

Чистые функции для аналитики и снимка маршрута на строке обратной связи.
Маршрут восстанавливается из сохранённого сообщения БЕЗ изменения hot-path
оркестратора (см. docs/guides/chat-observability-and-feedback.md):

* ``agent_ref`` задан → ответ форвернут во внешнего БЗ-агента (``kb_agent``);
* есть блок ``client_action`` или ``buttons`` → локальный action-tool
  (``non_kb_llm``);
* иначе → локальный текстовый ответ (``smalltalk`` — болталка либо вопрос
  не про базу знаний, на который LLM ответила текстом без tool'ов).

Эвристика приблизительна: ``smalltalk`` и «вопрос не про БЗ без tool-вызова»
неотличимы по сохранённым данным (оба дают текстовый блок). Точное разделение
потребовало бы персиста интента/маршрута в оркестраторе — вынесено в открытые
вопросы.
"""

from __future__ import annotations

# Значения route_type (снимок маршрута ответа ассистента):
ROUTE_KB_AGENT = "kb_agent"        # форвард во внешнего БЗ-агента через шину
ROUTE_NON_KB_LLM = "non_kb_llm"    # локальная LLM с вызовом action-tool'а
ROUTE_SMALLTALK = "smalltalk"      # локальный текстовый ответ (болталка / не-БЗ)
ROUTE_UNKNOWN = "unknown"          # не assistant-сообщение

# Значения outcome (исход ответа):
OUTCOME_OK = "ok"
OUTCOME_ERROR = "error"

# Типы блоков, означающие вызов локального action-tool'а.
# IMPORTANT: при добавлении нового tool-invoking типа блока (чек-лист
# «новый тип блока» в CLAUDE.md / dev-guide) дополни это множество —
# иначе ответы с ним молча классифицируются как smalltalk и аналитика
# by_route искажается.
_TOOL_BLOCK_TYPES = frozenset({"client_action", "buttons"})


def _block_types(message: dict) -> set[str]:
    """Множество типов блоков из content сообщения (устойчиво к мусору)."""
    blocks = message.get("content") or []
    types: set[str] = set()
    if isinstance(blocks, list):
        for b in blocks:
            if isinstance(b, dict):
                t = b.get("type")
                if isinstance(t, str):
                    types.add(t)
    return types


def classify_route(message: dict) -> str:
    """Определяет маршрут ответа ассистента по сохранённому сообщению.

    :param message: строка ``chat_messages`` (dict с ключами ``role``,
        ``content``, ``agent_ref``).
    :returns: одно из ``ROUTE_*``. Для не-assistant сообщений — ``ROUTE_UNKNOWN``.
    """
    if message.get("role") != "assistant":
        return ROUTE_UNKNOWN
    if message.get("agent_ref"):
        return ROUTE_KB_AGENT
    if _block_types(message) & _TOOL_BLOCK_TYPES:
        return ROUTE_NON_KB_LLM
    return ROUTE_SMALLTALK


def outcome(message: dict) -> str:
    """Исход ответа: ``error`` если ``status='failed'`` или есть error-блок."""
    if message.get("status") == "failed":
        return OUTCOME_ERROR
    if "error" in _block_types(message):
        return OUTCOME_ERROR
    return OUTCOME_OK
