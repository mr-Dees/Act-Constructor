"""Тесты ChatAnalyticsService (композиция фидбэка/сообщений + классификатор)."""

from unittest.mock import AsyncMock, MagicMock

from app.domains.chat.services import route_classifier as rc
from app.domains.chat.services.chat_analytics_service import ChatAnalyticsService


def _svc(*, feedback_repo=None, msg_repo=None):
    return ChatAnalyticsService(
        feedback_repo=feedback_repo or MagicMock(),
        msg_repo=msg_repo or MagicMock(),
    )


async def test_get_stats_passthrough():
    fb = MagicMock()
    fb.get_stats = AsyncMock(return_value={"total": 5, "up": 4, "down": 1})
    svc = _svc(feedback_repo=fb)
    res = await svc.get_stats(route_type="kb_agent", date_from="2026-01-01")
    assert res["total"] == 5
    fb.get_stats.assert_awaited_once()
    assert fb.get_stats.await_args.kwargs["route_type"] == "kb_agent"


async def test_list_feedback_shapes_answer_text_and_hides_content():
    fb = MagicMock()
    fb.list_feedback = AsyncMock(return_value=([
        {
            "message_id": "m1", "conversation_id": "c1", "user_id": "u1",
            "rating": "down", "reasons": ["inaccurate"], "comment": "ошибка",
            "route_type": "kb_agent", "agent_mode": "always", "model": "gpt-4o",
            "created_at": None, "updated_at": None, "message_status": "complete",
            "message_content": [
                {"type": "text", "content": "Ответ ассистента"},
                {"type": "error", "message": "boom"},
            ],
        },
    ], 1))
    svc = _svc(feedback_repo=fb)
    res = await svc.list_feedback(rating="down", limit=10)
    assert res["total"] == 1
    item = res["items"][0]
    assert item["rating"] == "down"
    assert "Ответ ассистента" in item["answer_text"]
    assert "[ошибка] boom" in item["answer_text"]
    # сырой message_content не утекает в выдачу
    assert "message_content" not in item


async def test_inspect_conversation_composes_route_outcome_feedback():
    msg_repo = MagicMock()
    msg_repo.get_by_conversation = AsyncMock(return_value=[
        {"id": "u1", "role": "user", "status": "complete",
         "content": [{"type": "text", "content": "Вопрос"}], "agent_ref": None},
        {"id": "a1", "role": "assistant", "status": "complete", "model": "gpt-4o",
         "token_usage": {"total_tokens": 10},
         "content": [{"type": "text", "content": "Ответ"}], "agent_ref": "q-uid"},
        {"id": "a2", "role": "assistant", "status": "failed",
         "content": [{"type": "error", "message": "fail"}], "agent_ref": None},
    ])
    fb = MagicMock()
    fb.get_all_for_conversation = AsyncMock(return_value={
        "a1": [{"user_id": "u1", "rating": "up", "reasons": None, "comment": None,
                "route_type": "kb_agent", "agent_mode": "always", "model": "gpt-4o",
                "created_at": None, "updated_at": None,
                "message_id": "a1", "conversation_id": "c1"}],
    })
    svc = _svc(feedback_repo=fb, msg_repo=msg_repo)

    res = await svc.inspect_conversation("c1")
    msgs = {m["id"]: m for m in res["messages"]}

    # user-сообщение: без route_type/outcome
    assert "route_type" not in msgs["u1"]

    # assistant с agent_ref → kb_agent, ok, есть оценка
    assert msgs["a1"]["route_type"] == rc.ROUTE_KB_AGENT
    assert msgs["a1"]["outcome"] == rc.OUTCOME_OK
    assert msgs["a1"]["feedback"][0]["rating"] == "up"

    # assistant failed → outcome error, smalltalk (нет agent_ref/блоков-действий)
    assert msgs["a2"]["outcome"] == rc.OUTCOME_ERROR
    assert msgs["a2"]["feedback"] == []

    # диалог короче лимита → усечения нет
    assert res["messages_truncated"] is False


async def test_inspect_conversation_flags_truncation_at_limit():
    """Диалог длиной ровно в лимит → messages_truncated=True (хвост мог
    быть отброшен), а не молчаливое усечение."""
    from app.domains.chat.services import chat_analytics_service as mod

    msg_repo = MagicMock()
    msg_repo.get_by_conversation = AsyncMock(return_value=[
        {"id": f"m{i}", "role": "user", "status": "complete",
         "content": [], "agent_ref": None}
        for i in range(mod._INSPECT_MESSAGES_LIMIT)
    ])
    fb = MagicMock()
    fb.get_all_for_conversation = AsyncMock(return_value={})
    svc = _svc(feedback_repo=fb, msg_repo=msg_repo)

    res = await svc.inspect_conversation("c1")
    assert res["messages_truncated"] is True
    # limit прокинут в репозиторий
    assert msg_repo.get_by_conversation.await_args.kwargs["limit"] == mod._INSPECT_MESSAGES_LIMIT


async def test_inspect_conversation_truncates_huge_block_text():
    """Текст блока длиннее _INSPECT_BLOCK_TEXT_LIMIT усечён с маркером и
    флагом content_truncated; исходный dict сообщения не мутируется."""
    from app.domains.chat.services import chat_analytics_service as mod

    huge = "х" * (mod._INSPECT_BLOCK_TEXT_LIMIT + 100)
    original_block = {"type": "text", "content": huge}
    msg_repo = MagicMock()
    msg_repo.get_by_conversation = AsyncMock(return_value=[
        {"id": "a1", "role": "assistant", "status": "complete",
         "content": [original_block, {"type": "text", "content": "короткий"}],
         "agent_ref": None},
    ])
    fb = MagicMock()
    fb.get_all_for_conversation = AsyncMock(return_value={})
    svc = _svc(feedback_repo=fb, msg_repo=msg_repo)

    res = await svc.inspect_conversation("c1")
    blocks = res["messages"][0]["content"]
    assert blocks[0]["content_truncated"] is True
    assert blocks[0]["content"].endswith("…[обрезано]")
    assert len(blocks[0]["content"]) < len(huge)
    # короткий блок не тронут, исходный блок не мутирован
    assert "content_truncated" not in blocks[1]
    assert original_block["content"] == huge


def test_extract_text_handles_garbage():
    assert ChatAnalyticsService._extract_text(None) == ""
    assert ChatAnalyticsService._extract_text("строка") == ""
    assert ChatAnalyticsService._extract_text([{"type": "text", "content": "a"},
                                               {"type": "image"}, 42]) == "a"
