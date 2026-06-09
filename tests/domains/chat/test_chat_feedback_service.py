"""Тесты ChatFeedbackService (валидация, derive route_type, аудит)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domains.chat.exceptions import ChatFeedbackValidationError
from app.domains.chat.services import route_classifier as rc
from app.domains.chat.services.chat_feedback_service import (
    MAX_COMMENT_LENGTH,
    ChatFeedbackService,
    feedback_public_dict,
)


def _msg(**kw):
    base = {
        "id": "m1",
        "conversation_id": "c1",
        "role": "assistant",
        "content": [{"type": "text", "content": "hi"}],
        "model": "gpt-4o",
        "agent_ref": None,
        "status": "complete",
    }
    base.update(kw)
    return base


def _service():
    repo = MagicMock()
    repo.upsert = AsyncMock(side_effect=lambda **kw: {**kw, "created_at": None, "updated_at": None})
    repo.clear = AsyncMock(return_value=True)
    audit = MagicMock()
    audit.log_feedback = AsyncMock()
    return ChatFeedbackService(repo=repo, audit_service=audit), repo, audit


async def test_submit_up_persists_rating_and_audits():
    svc, repo, audit = _service()
    await svc.submit(message=_msg(), user_id="u1", rating="up")
    repo.upsert.assert_awaited_once()
    kw = repo.upsert.await_args.kwargs
    assert kw["rating"] == "up"
    assert kw["route_type"] == rc.ROUTE_SMALLTALK
    assert kw["model"] == "gpt-4o"
    assert kw["source"] == "user"
    audit.log_feedback.assert_awaited_once()


async def test_submit_up_drops_reasons_and_comment():
    """Лайк не несёт причин/комментария — форма не показывается (UX)."""
    svc, repo, _ = _service()
    await svc.submit(
        message=_msg(), user_id="u1", rating="up",
        reasons=["inaccurate"], comment="зачем",
    )
    kw = repo.upsert.await_args.kwargs
    assert kw["reasons"] is None
    assert kw["comment"] is None


async def test_submit_down_keeps_reasons_and_trims_comment():
    svc, repo, _ = _service()
    await svc.submit(
        message=_msg(), user_id="u1", rating="down",
        reasons=["inaccurate", "other"], comment="  плохо  ",
    )
    kw = repo.upsert.await_args.kwargs
    assert kw["reasons"] == ["inaccurate", "other"]
    assert kw["comment"] == "плохо"


async def test_submit_dedups_reasons_preserving_order():
    svc, repo, _ = _service()
    await svc.submit(
        message=_msg(), user_id="u1", rating="down",
        reasons=["other", "other", "inaccurate"],
    )
    assert repo.upsert.await_args.kwargs["reasons"] == ["other", "inaccurate"]


async def test_submit_invalid_rating_raises():
    svc, repo, _ = _service()
    with pytest.raises(ChatFeedbackValidationError):
        await svc.submit(message=_msg(), user_id="u1", rating="meh")
    repo.upsert.assert_not_awaited()


async def test_submit_unknown_reason_raises():
    svc, repo, _ = _service()
    with pytest.raises(ChatFeedbackValidationError):
        await svc.submit(
            message=_msg(), user_id="u1", rating="down", reasons=["bogus"],
        )
    repo.upsert.assert_not_awaited()


async def test_submit_non_assistant_message_raises():
    svc, repo, _ = _service()
    with pytest.raises(ChatFeedbackValidationError):
        await svc.submit(message=_msg(role="user"), user_id="u1", rating="up")
    repo.upsert.assert_not_awaited()


async def test_submit_comment_too_long_raises():
    svc, repo, _ = _service()
    with pytest.raises(ChatFeedbackValidationError):
        await svc.submit(
            message=_msg(), user_id="u1", rating="down",
            comment="x" * (MAX_COMMENT_LENGTH + 1),
        )


async def test_submit_route_kb_agent_when_agent_ref():
    svc, repo, _ = _service()
    await svc.submit(message=_msg(agent_ref="q-uid"), user_id="u1", rating="up")
    assert repo.upsert.await_args.kwargs["route_type"] == rc.ROUTE_KB_AGENT


async def test_submit_passes_agent_mode_snapshot():
    svc, repo, _ = _service()
    await svc.submit(message=_msg(), user_id="u1", rating="up", agent_mode="adaptive")
    assert repo.upsert.await_args.kwargs["agent_mode"] == "adaptive"


async def test_clear_calls_repo_and_audits():
    svc, repo, audit = _service()
    await svc.clear(conversation_id="c1", message_id="m1", user_id="u1")
    repo.clear.assert_awaited_once()
    audit.log_feedback.assert_awaited_once()


async def test_clear_no_audit_when_nothing_deleted():
    svc, repo, audit = _service()
    repo.clear = AsyncMock(return_value=False)
    await svc.clear(conversation_id="c1", message_id="m1", user_id="u1")
    audit.log_feedback.assert_not_awaited()


async def test_submit_survives_without_audit_service():
    """audit_service=None — submit не падает."""
    repo = MagicMock()
    repo.upsert = AsyncMock(return_value={"rating": "up"})
    svc = ChatFeedbackService(repo=repo, audit_service=None)
    res = await svc.submit(message=_msg(), user_id="u1", rating="up")
    assert res["rating"] == "up"


def test_feedback_public_dict_minimal_no_internal_leak():
    row = {
        "rating": "down", "reasons": ["x"], "comment": "c", "updated_at": "t",
        "source": "user", "route_type": "kb_agent", "conversation_id": "c1",
    }
    pub = feedback_public_dict(row)
    assert pub == {"rating": "down", "reasons": ["x"], "comment": "c", "updated_at": "t"}
    assert "route_type" not in pub
    assert "source" not in pub


def test_feedback_public_dict_none():
    assert feedback_public_dict(None) is None
