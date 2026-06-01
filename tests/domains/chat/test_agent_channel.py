"""Тесты сервиса agent_channel.py.

Покрывают: map_answer_to_blocks, build_timeout_error_block,
AgentChannelService.submit, AgentChannelService.try_finalize.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.domains.chat.exceptions import ChatLimitError
from app.domains.chat.services.agent_channel import (
    AgentChannelService,
    build_timeout_error_block,
    map_answer_to_blocks,
)
from app.domains.chat.settings import ChatDomainSettings


# ── Фикстуры ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _patch_adapter():
    """Подменяет get_adapter, чтобы BaseRepository работал вне init_db()."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    with patch("app.db.repositories.base.get_adapter", return_value=adapter):
        yield


@pytest.fixture
def settings():
    """ChatDomainSettings с дефолтными значениями."""
    return ChatDomainSettings()


@pytest.fixture
def mock_conn():
    """Mock asyncpg.Connection."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock()
    conn.fetchval = AsyncMock()
    conn.fetch = AsyncMock()
    conn.execute = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


@pytest.fixture
def service(mock_conn, settings):
    return AgentChannelService(mock_conn, settings)


# ── map_answer_to_blocks ──────────────────────────────────────────────────────


class TestMapAnswerToBlocks:

    def test_text_and_thinking_produces_reasoning_then_text(self):
        """reasoning (из thinking) идёт первым, затем text."""
        row = {
            "id": "a1",
            "content": "Ответ агента",
            "metadata": {"thinking": "Рассуждение агента"},
            "buttons": None,
            "media": None,
        }
        blocks = map_answer_to_blocks(row)
        assert len(blocks) == 2
        assert blocks[0]["type"] == "reasoning"
        assert blocks[0]["content"] == "Рассуждение агента"
        assert blocks[0]["block_id"] == "a1:reasoning:0"
        assert blocks[1]["type"] == "text"
        assert blocks[1]["content"] == "Ответ агента"

    def test_buttons_get_block_id(self):
        """Кнопки получают block_id вида «{id}:btn:0» и нормализуются."""
        row = {
            "id": "a1",
            "content": "",
            "metadata": {},
            "buttons": [
                {"action_id": "act_1", "label": "Да", "params": {"key": "v"}},
                {"action_id": "act_2", "label": "Нет"},
            ],
            "media": None,
        }
        blocks = map_answer_to_blocks(row)
        btn_blocks = [b for b in blocks if b["type"] == "buttons"]
        assert len(btn_blocks) == 1
        assert btn_blocks[0]["block_id"] == "a1:btn:0"
        assert btn_blocks[0]["buttons"][0]["params"] == {"key": "v"}
        assert btn_blocks[0]["buttons"][1]["params"] == {}  # дефолт

    def test_media_image_by_mime(self):
        """media с image/* mime → блок type='image'."""
        row = {
            "id": "a2",
            "content": None,
            "metadata": {},
            "buttons": None,
            "media": [{"file_id": "f1", "filename": "photo.jpg", "mime_type": "image/jpeg"}],
        }
        blocks = map_answer_to_blocks(row)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "image"
        assert blocks[0]["file_id"] == "f1"
        assert blocks[0]["alt"] == "photo.jpg"

    def test_media_non_image_file_block(self):
        """media с не-image/* mime → блок type='file'."""
        row = {
            "id": "a3",
            "content": None,
            "metadata": {},
            "buttons": None,
            "media": [{
                "file_id": "f2",
                "filename": "report.pdf",
                "mime_type": "application/pdf",
                "file_size": 1024,
            }],
        }
        blocks = map_answer_to_blocks(row)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "file"
        assert blocks[0]["filename"] == "report.pdf"
        assert blocks[0]["mime_type"] == "application/pdf"
        assert blocks[0]["file_size"] == 1024

    def test_single_media_dict_wrapped_in_list(self):
        """Одиночный dict в media → оборачивается в список."""
        row = {
            "id": "a4",
            "content": None,
            "metadata": {},
            "buttons": None,
            "media": {"file_id": "f3", "filename": "x.png", "mime_type": "image/png"},
        }
        blocks = map_answer_to_blocks(row)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "image"

    def test_empty_fields_skipped(self):
        """Пустые/None поля не создают блоки."""
        row = {
            "id": "a5",
            "content": "",
            "metadata": {},
            "buttons": None,
            "media": None,
        }
        blocks = map_answer_to_blocks(row)
        assert blocks == []

    def test_none_content_skipped(self):
        """None content не создаёт блок text."""
        row = {
            "id": "a6",
            "content": None,
            "metadata": {},
            "buttons": [],
            "media": None,
        }
        blocks = map_answer_to_blocks(row)
        assert blocks == []

    def test_order_reasoning_text_buttons_media(self):
        """Порядок: reasoning → text → buttons → media."""
        row = {
            "id": "ord",
            "content": "Текст",
            "metadata": {"thinking": "Рассуждение"},
            "buttons": [{"action_id": "a", "label": "Кнопка"}],
            "media": [{"file_id": "f", "filename": "pic.png", "mime_type": "image/png"}],
        }
        blocks = map_answer_to_blocks(row)
        types = [b["type"] for b in blocks]
        assert types == ["reasoning", "text", "buttons", "image"]

    def test_long_text_trimmed(self):
        """Длинный текст обрезается до max_block_text_size байт + маркер."""
        long_text = "А" * 1000  # каждый символ — 2 байта в UTF-8
        row = {
            "id": "trim",
            "content": long_text,
            "metadata": {},
            "buttons": None,
            "media": None,
        }
        blocks = map_answer_to_blocks(row, max_block_text_size=50)
        assert len(blocks) == 1
        result = blocks[0]["content"]
        assert result.endswith("…[обрезано]")
        assert len(result.encode("utf-8")) <= 50

    def test_long_thinking_trimmed(self):
        """Длинный thinking обрезается."""
        long_thinking = "Б" * 500
        row = {
            "id": "trim2",
            "content": None,
            "metadata": {"thinking": long_thinking},
            "buttons": None,
            "media": None,
        }
        blocks = map_answer_to_blocks(row, max_block_text_size=30)
        assert blocks[0]["type"] == "reasoning"
        assert blocks[0]["content"].endswith("…[обрезано]")
        assert len(blocks[0]["content"].encode("utf-8")) <= 30


# ── build_timeout_error_block ─────────────────────────────────────────────────


class TestBuildTimeoutErrorBlock:

    def test_structure(self):
        block = build_timeout_error_block()
        assert block["type"] == "error"
        assert block["code"] == "agent_timeout"
        assert "message" in block
        assert isinstance(block["message"], str)


# ── AgentChannelService.submit ────────────────────────────────────────────────


class TestAgentChannelServiceSubmit:

    async def test_submit_calls_insert_question_and_create_streaming(
        self, mock_conn, settings
    ):
        """submit вызывает insert_question с pending-семантикой и create_streaming с agent_ref."""
        fake_agent_repo = AsyncMock()
        fake_agent_repo.insert_question = AsyncMock(return_value={"id": "q-1"})
        fake_agent_repo.count_active_for_user = AsyncMock(return_value=0)

        fake_msg_repo = AsyncMock()
        fake_msg_repo.create_streaming = AsyncMock(return_value={"id": "msg-1", "status": "streaming"})

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        question_uid = await svc.submit(
            conversation_id="conv-1",
            user_id="user1",
            assistant_message_id="msg-1",
            text="Вопрос агенту",
            mode="qa",
            kb="oarb",
        )

        # insert_question вызван с корректными параметрами
        fake_agent_repo.insert_question.assert_called_once()
        call_kwargs = fake_agent_repo.insert_question.call_args.kwargs
        assert call_kwargs["content"] == "Вопрос агенту"
        assert call_kwargs["user_id"] == "user1"
        assert call_kwargs["chat_id"] == "conv-1"
        assert call_kwargs["metadata"]["mode"] == "qa"
        assert call_kwargs["metadata"]["kb"] == "oarb"

        # question_uid — это conversation_id вопроса
        assert call_kwargs["conversation_id"] == question_uid

        # create_streaming вызван с agent_ref = question_uid
        fake_msg_repo.create_streaming.assert_called_once()
        streaming_kwargs = fake_msg_repo.create_streaming.call_args.kwargs
        assert streaming_kwargs["message_id"] == "msg-1"
        assert streaming_kwargs["conversation_id"] == "conv-1"
        assert streaming_kwargs["agent_ref"] == question_uid

    async def test_submit_returns_question_uid(self, mock_conn, settings):
        """submit возвращает question_uid (строку UUID)."""
        fake_agent_repo = AsyncMock()
        fake_agent_repo.insert_question = AsyncMock(return_value={"id": "q-1"})
        fake_agent_repo.count_active_for_user = AsyncMock(return_value=0)
        fake_msg_repo = AsyncMock()
        fake_msg_repo.create_streaming = AsyncMock(return_value={"id": "m-1"})

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        result = await svc.submit(
            conversation_id="c",
            user_id="u",
            assistant_message_id="m",
            text="q",
            mode="qa",
        )
        # Результат — строка в формате UUID
        import uuid
        uuid.UUID(result)  # выброс ValueError если неверный формат


# ── AgentChannelService.try_finalize ─────────────────────────────────────────


class TestAgentChannelServiceTryFinalize:

    async def test_no_reply_to_returns_pending(self, mock_conn, settings):
        """Если reply_to ещё нет — возвращает 'pending'."""
        question = {
            "id": "q-1",
            "conversation_id": "q-uid",
            "role": "user",
            "status": "pending",
            "reply_to": None,
        }

        fake_agent_repo = AsyncMock()
        fake_agent_repo.get_by_uid = AsyncMock(return_value=question)

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo

        result = await svc.try_finalize(
            assistant_message_id="msg-1",
            question_uid="q-uid",
        )

        assert result == "pending"
        fake_agent_repo.get_by_uid.assert_called_once_with("q-uid")

    async def test_reply_to_present_answer_ok_finalizes_and_returns_done(
        self, mock_conn, settings
    ):
        """Если reply_to есть и ответ не error → finalize + 'done'."""
        question = {
            "id": "q-1",
            "conversation_id": "q-uid",
            "status": "complete",
            "reply_to": "a-uid",
        }
        answer = {
            "id": "a-1",
            "conversation_id": "a-uid",
            "role": "assistant",
            "content": "Ответ от агента",
            "metadata": {},
            "buttons": None,
            "media": None,
            "status": "complete",
        }

        fake_agent_repo = AsyncMock()
        fake_agent_repo.get_by_uid = AsyncMock(side_effect=lambda uid: {
            "q-uid": question,
            "a-uid": answer,
        }.get(uid))

        fake_msg_repo = AsyncMock()
        fake_msg_repo.finalize = AsyncMock(return_value=True)
        fake_msg_repo.mark_failed = AsyncMock(return_value=True)

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        result = await svc.try_finalize(
            assistant_message_id="msg-1",
            question_uid="q-uid",
        )

        assert result == "done"
        fake_msg_repo.finalize.assert_called_once()
        call_kwargs = fake_msg_repo.finalize.call_args.kwargs
        assert call_kwargs["message_id"] == "msg-1"
        # Убеждаемся что blocks содержат text-блок с ответом
        blocks = call_kwargs["final_blocks"]
        text_blocks = [b for b in blocks if b["type"] == "text"]
        assert len(text_blocks) == 1
        assert text_blocks[0]["content"] == "Ответ от агента"

    async def test_answer_status_error_calls_mark_failed_and_returns_done(
        self, mock_conn, settings
    ):
        """Если answer.status == 'error' → mark_failed + 'done'."""
        question = {
            "id": "q-2",
            "conversation_id": "q-uid",
            "status": "complete",
            "reply_to": "a-uid",
        }
        answer = {
            "id": "a-2",
            "conversation_id": "a-uid",
            "role": "assistant",
            "content": "Ошибка в агенте",
            "metadata": {},
            "buttons": None,
            "media": None,
            "status": "error",
        }

        fake_agent_repo = AsyncMock()
        fake_agent_repo.get_by_uid = AsyncMock(side_effect=lambda uid: {
            "q-uid": question,
            "a-uid": answer,
        }.get(uid))

        fake_msg_repo = AsyncMock()
        fake_msg_repo.finalize = AsyncMock(return_value=True)
        fake_msg_repo.mark_failed = AsyncMock(return_value=True)

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        result = await svc.try_finalize(
            assistant_message_id="msg-2",
            question_uid="q-uid",
        )

        assert result == "done"
        fake_msg_repo.mark_failed.assert_called_once()
        call_kwargs = fake_msg_repo.mark_failed.call_args.kwargs
        assert call_kwargs["message_id"] == "msg-2"
        assert call_kwargs["error_block"]["type"] == "error"
        assert call_kwargs["error_block"]["code"] == "agent_error"
        # finalize НЕ вызывался
        fake_msg_repo.finalize.assert_not_called()

    async def test_try_finalize_calls_translate_buttons_when_answer_has_buttons(
        self, mock_conn, settings
    ):
        """try_finalize вызывает translate_buttons для ответа с кнопками."""
        question = {
            "id": "q-3",
            "conversation_id": "q-uid",
            "status": "complete",
            "reply_to": "a-uid",
        }
        answer = {
            "id": "a-3",
            "conversation_id": "a-uid",
            "role": "assistant",
            "content": "Нашёл",
            "metadata": {},
            "buttons": [{"action_id": "acts.open_act_page", "label": "Открыть", "params": {"km_number": "КМ-23-001"}}],
            "media": None,
            "status": "complete",
        }

        fake_agent_repo = AsyncMock()
        fake_agent_repo.get_by_uid = AsyncMock(side_effect=lambda uid: {
            "q-uid": question,
            "a-uid": answer,
        }.get(uid))

        fake_msg_repo = AsyncMock()
        fake_msg_repo.finalize = AsyncMock(return_value=True)

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        original_buttons = answer["buttons"].copy()
        translated = [{"action_id": "open_url", "label": "Открыть", "params": {"url": "/constructor?act_id=1"}}]
        with patch(
            "app.domains.chat.services.agent_channel.translate_buttons",
            new=AsyncMock(return_value=translated),
        ) as mock_translate:
            result = await svc.try_finalize(
                assistant_message_id="msg-3",
                question_uid="q-uid",
            )

        assert result == "done"
        mock_translate.assert_called_once_with(original_buttons)
        # Финальные блоки содержат кнопки с action_id="open_url"
        call_kwargs = fake_msg_repo.finalize.call_args.kwargs
        btn_blocks = [b for b in call_kwargs["final_blocks"] if b["type"] == "buttons"]
        assert len(btn_blocks) == 1
        assert btn_blocks[0]["buttons"][0]["action_id"] == "open_url"

    async def test_try_finalize_skips_translate_buttons_when_no_buttons(
        self, mock_conn, settings
    ):
        """try_finalize НЕ вызывает translate_buttons если кнопок нет."""
        question = {
            "id": "q-4",
            "conversation_id": "q-uid",
            "status": "complete",
            "reply_to": "a-uid",
        }
        answer = {
            "id": "a-4",
            "conversation_id": "a-uid",
            "role": "assistant",
            "content": "Ответ без кнопок",
            "metadata": {},
            "buttons": None,
            "media": None,
            "status": "complete",
        }

        fake_agent_repo = AsyncMock()
        fake_agent_repo.get_by_uid = AsyncMock(side_effect=lambda uid: {
            "q-uid": question,
            "a-uid": answer,
        }.get(uid))

        fake_msg_repo = AsyncMock()
        fake_msg_repo.finalize = AsyncMock(return_value=True)

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        with patch(
            "app.domains.chat.services.agent_channel.translate_buttons",
            new=AsyncMock(),
        ) as mock_translate:
            await svc.try_finalize(
                assistant_message_id="msg-4",
                question_uid="q-uid",
            )

        mock_translate.assert_not_called()


# ── AgentChannelService.submit — лимит ───────────────────────────────────────


class TestAgentChannelServiceSubmitLimit:

    async def test_submit_raises_chat_limit_error_when_active_at_limit(
        self, mock_conn, settings
    ):
        """submit кидает ChatLimitError если active >= max_parallel_streams_per_user."""
        fake_agent_repo = AsyncMock()
        fake_agent_repo.count_active_for_user = AsyncMock(
            return_value=settings.max_parallel_streams_per_user
        )
        fake_agent_repo.insert_question = AsyncMock()
        fake_msg_repo = AsyncMock()
        fake_msg_repo.create_streaming = AsyncMock()

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        with pytest.raises(ChatLimitError) as exc_info:
            await svc.submit(
                conversation_id="conv-1",
                user_id="user1",
                assistant_message_id="msg-1",
                text="Вопрос",
                mode="always",
            )

        assert "лимит" in str(exc_info.value).lower()
        # insert_question НЕ вызывался
        fake_agent_repo.insert_question.assert_not_called()
        fake_msg_repo.create_streaming.assert_not_called()

    async def test_submit_proceeds_when_active_below_limit(
        self, mock_conn, settings
    ):
        """submit работает как раньше если active < max_parallel_streams_per_user."""
        fake_agent_repo = AsyncMock()
        fake_agent_repo.count_active_for_user = AsyncMock(
            return_value=settings.max_parallel_streams_per_user - 1
        )
        fake_agent_repo.insert_question = AsyncMock(return_value={"id": "q-1"})
        fake_msg_repo = AsyncMock()
        fake_msg_repo.create_streaming = AsyncMock(return_value={"id": "m-1"})

        svc = AgentChannelService(mock_conn, settings)
        svc._agent_repo = lambda: fake_agent_repo
        svc._message_repo = lambda: fake_msg_repo

        result = await svc.submit(
            conversation_id="conv-1",
            user_id="user1",
            assistant_message_id="msg-1",
            text="Вопрос",
            mode="always",
        )

        import uuid
        uuid.UUID(result)  # корректный UUID
        fake_agent_repo.insert_question.assert_called_once()
        fake_msg_repo.create_streaming.assert_called_once()
