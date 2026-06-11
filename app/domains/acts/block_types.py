"""Канонические типы узлов дерева конструктора актов (решение Б-2.6).

Single source of truth для строковых типов узлов (item / table / textblock /
violation), которые иначе разбросаны по схеме (``ActItemSchema.type`` Literal),
трём форматтерам экспорта (text / markdown / docx) и санитайзеру.

ВАЖНО: набор типов синхронизируется ВРУЧНУЮ с фронтовым реестром
``static/js/constructor/block-types.js`` (как ``app/core/chat/names.py`` ↔
``chat-client-actions.js``): фронт не импортирует Python. Соответствие
Literal-схемы и обработки во всех трёх форматтерах закреплено тест-стражем
``tests/domains/acts/test_block_types_guard.py`` — тип, добавленный здесь,
провалит страж, пока не появятся фикстура и ветки обработки.

Как добавить новый тип блока — чек-лист в developer-guide §10.10.
"""
from __future__ import annotations

from typing import Final

# ── Типы узлов дерева (значения поля type в ActItemSchema) ───────────────────

NODE_TYPE_ITEM: Final[str] = "item"
NODE_TYPE_TABLE: Final[str] = "table"
NODE_TYPE_TEXTBLOCK: Final[str] = "textblock"
NODE_TYPE_VIOLATION: Final[str] = "violation"

# Полный набор типов узлов. Обязан совпадать с Literal в ActItemSchema.type —
# Literal в схеме статичен сознательно (динамический Literal из переменных
# капризен для type checker'ов), соответствие пинит тест-страж.
NODE_TYPES: Final[frozenset[str]] = frozenset({
    NODE_TYPE_ITEM,
    NODE_TYPE_TABLE,
    NODE_TYPE_TEXTBLOCK,
    NODE_TYPE_VIOLATION,
})

# Листовые типы-блоки контента: узел несёт ссылку на запись словаря
# ActDataSchema (tables / textBlocks / violations).
LEAF_BLOCK_TYPES: Final[frozenset[str]] = frozenset({
    NODE_TYPE_TABLE,
    NODE_TYPE_TEXTBLOCK,
    NODE_TYPE_VIOLATION,
})

# Маппинг leaf-тип → (поле-ссылка узла, имя словаря в ActDataSchema).
# Зеркало полей idProp/dictName фронтового реестра block-types.js.
LEAF_BLOCK_REFS: Final[dict[str, tuple[str, str]]] = {
    NODE_TYPE_TABLE: ("tableId", "tables"),
    NODE_TYPE_TEXTBLOCK: ("textBlockId", "textBlocks"),
    NODE_TYPE_VIOLATION: ("violationId", "violations"),
}
