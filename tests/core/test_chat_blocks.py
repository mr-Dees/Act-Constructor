"""Тесты блоков сообщений и схем сериализации чата."""

import pytest
from pydantic import ValidationError

from app.core.chat.blocks import (
    ActionButton,
    ButtonGroup,
    CodeBlock,
    FileBlock,
    ImageBlock,
    MessageBlock,
    PlanBlock,
    PlanStep,
    QuickReplyButton,
    ReasoningBlock,
    TextBlock,
)
from app.core.chat.schemas import parse_message_blocks, serialize_message_blocks


class TestTextBlock:
    """Тесты текстового блока."""

    def test_create(self):
        block = TextBlock(content="Привет, мир!")
        assert block.type == "text"
        assert block.content == "Привет, мир!"

    def test_serialization(self):
        block = TextBlock(content="Тест")
        data = block.model_dump()
        assert data == {"type": "text", "content": "Тест"}


class TestCodeBlock:
    """Тесты блока кода."""

    def test_create(self):
        block = CodeBlock(language="python", content="print('hello')")
        assert block.type == "code"
        assert block.language == "python"
        assert block.content == "print('hello')"

    def test_default_language(self):
        block = CodeBlock(content="some code")
        assert block.language == "plain"


class TestReasoningBlock:
    """Тесты блока рассуждений."""

    def test_create(self):
        block = ReasoningBlock(content="Анализируем данные...")
        assert block.type == "reasoning"
        assert block.content == "Анализируем данные..."


class TestPlanBlock:
    """Тесты блока плана."""

    def test_create_with_steps(self):
        steps = [
            PlanStep(label="Шаг 1", status="completed"),
            PlanStep(label="Шаг 2", status="in_progress"),
            PlanStep(label="Шаг 3", status="pending"),
        ]
        block = PlanBlock(steps=steps)
        assert block.type == "plan"
        assert len(block.steps) == 3
        assert block.steps[0].label == "Шаг 1"
        assert block.steps[0].status == "completed"
        assert block.steps[1].status == "in_progress"
        assert block.steps[2].status == "pending"

    def test_invalid_status_raises_validation_error(self):
        with pytest.raises(ValidationError):
            PlanStep(label="Шаг", status="unknown")


class TestFileBlock:
    """Тесты файлового блока."""

    def test_create(self):
        block = FileBlock(
            file_id="f-123",
            filename="report.pdf",
            mime_type="application/pdf",
            file_size=1024,
        )
        assert block.type == "file"
        assert block.file_id == "f-123"
        assert block.filename == "report.pdf"
        assert block.mime_type == "application/pdf"
        assert block.file_size == 1024


class TestImageBlock:
    """Тесты блока изображения."""

    def test_create(self):
        block = ImageBlock(file_id="img-456", alt="Скриншот")
        assert block.type == "image"
        assert block.file_id == "img-456"
        assert block.alt == "Скриншот"

    def test_default_alt(self):
        block = ImageBlock(file_id="img-789")
        assert block.alt == ""


class TestButtonGroup:
    """Тесты группы кнопок."""

    def test_quick_reply_variant(self):
        buttons = [
            QuickReplyButton(label="Да", value="yes"),
            QuickReplyButton(label="Нет", value="no"),
        ]
        group = ButtonGroup(variant="quick_reply", buttons=buttons)
        assert group.type == "buttons"
        assert group.variant == "quick_reply"
        assert len(group.buttons) == 2
        assert group.buttons[0].label == "Да"
        assert group.buttons[0].value == "yes"

    def test_action_variant(self):
        buttons = [
            ActionButton(
                id="act-1",
                label="Запустить проверку",
                domain="acts",
                params={"km": "КМ-01-00001"},
                confirm=True,
            ),
        ]
        group = ButtonGroup(variant="action", buttons=buttons)
        assert group.type == "buttons"
        assert group.variant == "action"
        assert len(group.buttons) == 1
        btn = group.buttons[0]
        assert btn.id == "act-1"
        assert btn.label == "Запустить проверку"
        assert btn.domain == "acts"
        assert btn.params == {"km": "КМ-01-00001"}
        assert btn.confirm is True

    def test_action_button_defaults(self):
        btn = ActionButton(id="a1", label="Тест", domain="admin")
        assert btn.params == {}
        assert btn.confirm is False


class TestMessageBlockUnion:
    """Тесты дискриминированного объединения блоков."""

    def test_parse_text_from_dict(self):
        raw = [{"type": "text", "content": "Привет"}]
        blocks = parse_message_blocks(raw)
        assert len(blocks) == 1
        assert isinstance(blocks[0], TextBlock)
        assert blocks[0].content == "Привет"

    def test_parse_mixed_blocks(self):
        raw = [
            {"type": "text", "content": "Описание"},
            {"type": "code", "language": "sql", "content": "SELECT 1"},
            {"type": "reasoning", "content": "Думаю..."},
            {
                "type": "plan",
                "steps": [
                    {"label": "Анализ", "status": "completed"},
                    {"label": "Реализация", "status": "pending"},
                ],
            },
            {
                "type": "file",
                "file_id": "f1",
                "filename": "data.csv",
                "mime_type": "text/csv",
                "file_size": 512,
            },
            {"type": "image", "file_id": "i1", "alt": "График"},
            {
                "type": "buttons",
                "variant": "quick_reply",
                "buttons": [{"label": "OK", "value": "ok"}],
            },
        ]
        blocks = parse_message_blocks(raw)
        assert len(blocks) == 7
        assert isinstance(blocks[0], TextBlock)
        assert isinstance(blocks[1], CodeBlock)
        assert isinstance(blocks[2], ReasoningBlock)
        assert isinstance(blocks[3], PlanBlock)
        assert isinstance(blocks[4], FileBlock)
        assert isinstance(blocks[5], ImageBlock)
        assert isinstance(blocks[6], ButtonGroup)

    def test_serialize_to_json(self):
        blocks = [
            TextBlock(content="Текст"),
            CodeBlock(language="python", content="x = 1"),
        ]
        result = serialize_message_blocks(blocks)
        assert result == [
            {"type": "text", "content": "Текст"},
            {"type": "code", "language": "python", "content": "x = 1"},
        ]

    def test_roundtrip(self):
        """Проверяем, что parse → serialize → parse даёт тот же результат."""
        raw = [
            {"type": "text", "content": "Текст"},
            {"type": "code", "language": "python", "content": "x = 1"},
            {
                "type": "plan",
                "steps": [{"label": "Шаг", "status": "pending"}],
            },
        ]
        blocks = parse_message_blocks(raw)
        serialized = serialize_message_blocks(blocks)
        blocks2 = parse_message_blocks(serialized)
        serialized2 = serialize_message_blocks(blocks2)
        assert serialized == serialized2
