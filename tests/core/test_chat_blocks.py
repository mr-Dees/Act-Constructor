"""Тесты блоков сообщений и схем сериализации чата."""

import pytest
from pydantic import ValidationError

from app.core.chat.blocks import (
    Button,
    ButtonGroup,
    CodeBlock,
    FileBlock,
    ImageBlock,
    MessageBlock,
    PlanBlock,
    PlanStep,
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

    def test_create_with_buttons(self):
        buttons = [
            Button(action_id="acts.open_act_page", label="Открыть КМ-23-001",
                   params={"km_number": "КМ-23-001"}),
            Button(action_id="acts.open_act_page", label="Открыть КМ-23-002",
                   params={"km_number": "КМ-23-002"}),
        ]
        group = ButtonGroup(buttons=buttons)
        assert group.type == "buttons"
        assert len(group.buttons) == 2
        assert group.buttons[0].action_id == "acts.open_act_page"
        assert group.buttons[0].label == "Открыть КМ-23-001"
        assert group.buttons[0].params == {"km_number": "КМ-23-001"}

    def test_button_defaults(self):
        btn = Button(action_id="a1", label="Тест")
        assert btn.params == {}


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
                "buttons": [{"action_id": "acts.open_act_page",
                             "label": "Открыть",
                             "params": {"km_number": "КМ-01-00001"}}],
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


def test_client_action_block_parses():
    from app.core.chat.blocks import ClientActionBlock
    block = ClientActionBlock(
        action="open_url",
        params={"url": "/acts/КМ-23-001"},
        label="Открываю акт КМ-23-001…",
    )
    assert block.type == "client_action"
    assert block.action == "open_url"
    assert block.params == {"url": "/acts/КМ-23-001"}
    assert block.label == "Открываю акт КМ-23-001…"


def test_client_action_block_in_discriminated_union():
    """Дискриминированное объединение должно знать про client_action."""
    from app.core.chat.schemas import parse_message_blocks
    blocks = parse_message_blocks([
        {"type": "client_action", "action": "notify",
         "params": {"message": "Привет"}, "label": None},
    ])
    assert len(blocks) == 1
    assert blocks[0].type == "client_action"
    assert blocks[0].action == "notify"
    assert blocks[0].label is None


def test_client_action_block_id_auto_generated():
    """При создании без явного block_id — генерируется валидный uuid4."""
    import uuid as _uuid
    from app.core.chat.blocks import ClientActionBlock

    block = ClientActionBlock(action="notify", params={"message": "Hi"})
    assert block.block_id
    # Проверяем, что это валидный uuid4 (парсится без исключений)
    parsed = _uuid.UUID(block.block_id)
    assert parsed.version == 4


def test_client_action_block_id_explicit():
    """Явно переданный block_id сохраняется без изменений."""
    from app.core.chat.blocks import ClientActionBlock

    explicit_id = "11111111-2222-3333-4444-555555555555"
    block = ClientActionBlock(
        action="notify",
        params={"message": "Hi"},
        block_id=explicit_id,
    )
    assert block.block_id == explicit_id


def test_client_action_block_id_unique_per_instance():
    """Два инстанса без явного block_id — получают разные uuid."""
    from app.core.chat.blocks import ClientActionBlock

    a = ClientActionBlock(action="notify", params={"message": "A"})
    b = ClientActionBlock(action="notify", params={"message": "B"})
    assert a.block_id != b.block_id


def test_client_action_block_id_in_model_dump():
    """block_id попадает в model_dump (это критично для SSE сериализации)."""
    from app.core.chat.blocks import ClientActionBlock

    block = ClientActionBlock(action="notify", params={"message": "Hi"})
    data = block.model_dump()
    assert "block_id" in data
    assert data["block_id"] == block.block_id


def test_client_action_block_id_via_discriminated_union():
    """Парсинг через дискриминированное объединение сохраняет block_id."""
    from app.core.chat.schemas import parse_message_blocks

    blocks = parse_message_blocks([
        {
            "type": "client_action",
            "action": "notify",
            "params": {"message": "Hi"},
            "label": None,
            "block_id": "fixed-id-xxx",
        },
    ])
    assert len(blocks) == 1
    assert blocks[0].block_id == "fixed-id-xxx"


def test_error_block_parses_with_code():
    from app.core.chat.blocks import ErrorBlock
    block = ErrorBlock(
        message="База знаний недоступна",
        code="kb_unavailable",
    )
    assert block.type == "error"
    assert block.message == "База знаний недоступна"
    assert block.code == "kb_unavailable"


def test_error_block_parses_without_code():
    from app.core.chat.blocks import ErrorBlock
    block = ErrorBlock(message="Что-то пошло не так")
    assert block.type == "error"
    assert block.code is None


def test_error_block_in_discriminated_union():
    """Дискриминированное объединение должно знать про error."""
    from app.core.chat.schemas import parse_message_blocks
    blocks = parse_message_blocks([
        {"type": "error", "message": "Сбой", "code": "kb_unavailable"},
        {"type": "error", "message": "Сбой без кода"},
    ])
    assert len(blocks) == 2
    assert blocks[0].type == "error"
    assert blocks[0].code == "kb_unavailable"
    assert blocks[1].code is None
