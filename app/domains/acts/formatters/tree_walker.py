"""Единый tree-walker форматтеров экспорта (решение Б-2.2).

До walker'а дерево акта обходили три независимые копии цикла
(text_formatter / markdown_formatter / docx/formatter) — добавление типа
блока требовало править каждую, а пропуск был молчаливым (блок исчезал из
одного формата). Walker сводит обход к одному месту:

- **walk(tree, visitor, blocks)** обходит дерево DFS и диспетчит узлы по
  типу: пункты — парой ``on_item_enter`` / ``on_item_exit`` (дети обходятся
  между ними), leaf-блоки — обработчиком ``on_<тип>`` из ``LEAF_BLOCK_REFS``
  (не хардкодим маппинг четвёртый раз) с уже разрешённой записью словаря
  контента (``None`` — ссылка висячая, решение за визитором).
- Walker отвечает ТОЛЬКО за обход и диспетч; представление — целиком в
  визиторах. Контекст обхода (depth, parent) передаётся параметром
  ``WalkContext`` — DOCX-визитор, например, выводит Word-нумерацию по depth.
- Единая семантика «item с прикреплённой таблицей» (tableId у узла
  type='item'): walker диспетчит таблицу в ``on_table`` тем же узлом для
  ЛЮБОГО визитора — потеря такой таблицы в одном из форматов становится
  невозможной по построению.

Унификация семантики (сознательные отличия от старых копий обхода):

- корень дерева не посещается — обход начинается с его детей (depth 0);
- дети обходятся у узла любого типа (как в MD/TXT; старый DOCX-обход
  не заглядывал в детей leaf-узлов — валидные деревья их не имеют);
- ``node.content`` и прочие поля узла рендерит визитор в своём
  обработчике — walker полей представления не интерпретирует.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from app.domains.acts.block_types import LEAF_BLOCK_REFS, NODE_TYPE_TABLE

# Поле-ссылка и имя словаря прикреплённой таблицы (для item-узлов с tableId).
_TABLE_REF_FIELD, _TABLE_DICT_NAME = LEAF_BLOCK_REFS[NODE_TYPE_TABLE]


@dataclass(frozen=True)
class WalkContext:
    """Контекст текущего узла: глубина (0 — дети корня) и родитель."""

    depth: int
    parent: Mapping[str, Any] | None


class TreeVisitor(Protocol):
    """Протокол визитора: по обработчику на тип узла.

    Leaf-обработчики получают узел, разрешённую запись словаря контента
    (или ``None`` при висячей ссылке) и контекст обхода.
    """

    def on_item_enter(self, node: Mapping[str, Any], ctx: WalkContext) -> None: ...

    def on_item_exit(self, node: Mapping[str, Any], ctx: WalkContext) -> None: ...

    def on_table(
        self, node: Mapping[str, Any], schema: Any | None, ctx: WalkContext
    ) -> None: ...

    def on_textblock(
        self, node: Mapping[str, Any], schema: Any | None, ctx: WalkContext
    ) -> None: ...

    def on_violation(
        self, node: Mapping[str, Any], schema: Any | None, ctx: WalkContext
    ) -> None: ...


def collect_blocks(data: Any) -> dict[str, Mapping[str, Any]]:
    """Собирает словари блоков контента для walk() из данных акта.

    Принимает и raw dict (`model_dump`, путь MD/TXT), и ``ActDataSchema``
    (путь DOCX) — имена словарей берутся из ``LEAF_BLOCK_REFS``.
    """
    blocks: dict[str, Mapping[str, Any]] = {}
    for _ref_field, dict_name in LEAF_BLOCK_REFS.values():
        if isinstance(data, Mapping):
            blocks[dict_name] = data.get(dict_name) or {}
        else:
            blocks[dict_name] = getattr(data, dict_name, None) or {}
    return blocks


def walk(
    tree: Mapping[str, Any],
    visitor: TreeVisitor,
    blocks: Mapping[str, Mapping[str, Any]],
) -> None:
    """Обходит дерево акта DFS и диспетчит узлы в обработчики визитора.

    Args:
        tree: Корневой узел дерева (сам не посещается).
        visitor: Визитор с обработчиками типов узлов (TreeVisitor).
        blocks: Словари блоков контента по именам из LEAF_BLOCK_REFS
            (см. collect_blocks).
    """
    for child in (tree or {}).get("children", []):
        _walk_node(child, visitor, blocks, depth=0, parent=tree)


def _walk_node(
    node: Mapping[str, Any],
    visitor: TreeVisitor,
    blocks: Mapping[str, Mapping[str, Any]],
    *,
    depth: int,
    parent: Mapping[str, Any],
) -> None:
    """Посещает узел, диспетчит его по типу и рекурсивно обходит детей."""
    node_type = node.get("type", "item")
    ctx = WalkContext(depth=depth, parent=parent)
    is_leaf_block = node_type in LEAF_BLOCK_REFS

    if is_leaf_block:
        ref_field, dict_name = LEAF_BLOCK_REFS[node_type]
        ref = node.get(ref_field)
        schema = (blocks.get(dict_name) or {}).get(ref) if ref else None
        # Обработчик зовётся и при schema=None: MD/TXT выводят заголовок
        # узла-таблицы даже без данных — решение за визитором.
        getattr(visitor, f"on_{node_type}")(node, schema, ctx)
    else:
        visitor.on_item_enter(node, ctx)
        attached_ref = node.get(_TABLE_REF_FIELD)
        if attached_ref:
            # Единая семантика «item с прикреплённой таблицей»: таблица
            # диспетчится тем же узлом (заголовком ей служит сам пункт).
            attached = (blocks.get(_TABLE_DICT_NAME) or {}).get(attached_ref)
            if attached is not None:
                visitor.on_table(node, attached, ctx)

    for child in node.get("children", []):
        _walk_node(child, visitor, blocks, depth=depth + 1, parent=node)

    if not is_leaf_block:
        visitor.on_item_exit(node, ctx)
