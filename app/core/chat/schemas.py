"""Утилиты парсинга и сериализации блоков сообщений.

Предоставляет ``parse_message_blocks`` и ``serialize_message_blocks`` для
преобразования между словарями и типизированными Pydantic-моделями блоков.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Discriminator, Tag, TypeAdapter

from app.core.chat.blocks import (
    ButtonGroup,
    CodeBlock,
    FileBlock,
    ImageBlock,
    MessageBlock,
    PlanBlock,
    ReasoningBlock,
    TextBlock,
)

# ---------------------------------------------------------------------------
# Дискриминированное объединение через TypeAdapter
# ---------------------------------------------------------------------------

_DiscriminatedBlock = Annotated[
    Annotated[TextBlock, Tag("text")]
    | Annotated[CodeBlock, Tag("code")]
    | Annotated[ReasoningBlock, Tag("reasoning")]
    | Annotated[PlanBlock, Tag("plan")]
    | Annotated[FileBlock, Tag("file")]
    | Annotated[ImageBlock, Tag("image")]
    | Annotated[ButtonGroup, Tag("buttons")],
    Discriminator("type"),
]

_block_adapter: TypeAdapter[_DiscriminatedBlock] = TypeAdapter(_DiscriminatedBlock)
_list_adapter: TypeAdapter[list[_DiscriminatedBlock]] = TypeAdapter(
    list[_DiscriminatedBlock]
)


# ---------------------------------------------------------------------------
# Публичный API
# ---------------------------------------------------------------------------


def parse_message_blocks(raw: list[dict]) -> list[MessageBlock]:
    """Разбирает список словарей в типизированные блоки сообщений.

    Каждый словарь должен содержать поле ``type`` для выбора конкретной
    модели блока через дискриминатор.
    """
    return _list_adapter.validate_python(raw)


def serialize_message_blocks(blocks: list[MessageBlock]) -> list[dict]:
    """Сериализует список блоков в простые словари."""
    return _list_adapter.dump_python(blocks, mode="python")
