"""Тесты ChatFeedbackService (валидация, derive route_type, аудит)."""

import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.domains.chat.exceptions import ChatFeedbackValidationError
from app.domains.chat.services import conversation_service as _conv_svc
from app.domains.chat.services import route_classifier as rc
from app.domains.chat.services.chat_feedback_service import (
    FEEDBACK_REASON_CODES,
    MAX_COMMENT_LENGTH,
    ChatFeedbackService,
    feedback_public_dict,
)


@pytest.fixture(autouse=True)
def _clean_user_locks():
    """Сброс глобального кэша per-user lock'ов между тестами.

    submit/clear используют _get_user_lock из conversation_service. Без сброса
    asyncio.Lock из закрытого event loop переиспользуется в новом → flaky
    «got Future attached to a different loop» (правило CLAUDE.md)."""
    _conv_svc._user_locks.clear()
    yield
    _conv_svc._user_locks.clear()


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


async def test_submit_unknown_agent_mode_raises():
    """Произвольная строка в agent_mode не должна попадать в аналитический срез."""
    svc, repo, _ = _service()
    with pytest.raises(ChatFeedbackValidationError):
        await svc.submit(
            message=_msg(), user_id="u1", rating="up", agent_mode="что-угодно",
        )
    repo.upsert.assert_not_awaited()


async def test_submit_empty_agent_mode_normalized_to_none():
    svc, repo, _ = _service()
    await svc.submit(message=_msg(), user_id="u1", rating="up", agent_mode="  ")
    assert repo.upsert.await_args.kwargs["agent_mode"] is None


async def test_submit_down_after_up_overwrites_rating():
    """Переключение up→down: вторая оценка перезаписывает первую с причинами."""
    svc, repo, _ = _service()
    await svc.submit(message=_msg(), user_id="u1", rating="up")
    await svc.submit(
        message=_msg(), user_id="u1", rating="down", reasons=["inaccurate"],
    )
    calls = repo.upsert.await_args_list
    assert len(calls) == 2
    assert calls[0].kwargs["rating"] == "up"
    assert calls[1].kwargs["rating"] == "down"
    assert calls[1].kwargs["reasons"] == ["inaccurate"]


async def test_submit_up_after_down_drops_reasons():
    """Переключение down→up: лайк сбрасывает причины/комментарий."""
    svc, repo, _ = _service()
    await svc.submit(
        message=_msg(), user_id="u1", rating="down",
        reasons=["inaccurate"], comment="плохо",
    )
    await svc.submit(message=_msg(), user_id="u1", rating="up")
    calls = repo.upsert.await_args_list
    assert calls[1].kwargs["rating"] == "up"
    assert calls[1].kwargs["reasons"] is None
    assert calls[1].kwargs["comment"] is None


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


def test_feedback_reason_codes_synced_with_frontend():
    """Коды причин дизлайка фронта (REASONS в chat-feedback.js) совпадают
    с FEEDBACK_REASON_CODES бэкенда.

    Синхронизация ручная (импорт из Python во фронт невозможен, как
    names.py ↔ chat-client-actions.js); тест ловит дрейф: новый код на
    бэке без фронта — пользователю не предложат, на фронте без бэка — 422.
    """
    js_path = (
        Path(__file__).resolve().parents[3]
        / "static" / "js" / "shared" / "chat" / "chat-feedback.js"
    )
    text = js_path.read_text(encoding="utf-8")
    m = re.search(r"const REASONS = \[(.*?)\];", text, re.DOTALL)
    assert m, "Блок REASONS не найден в chat-feedback.js"
    js_codes = re.findall(r"code:\s*'([^']+)'", m.group(1))
    assert js_codes, "В REASONS не распознано ни одного кода"
    assert set(js_codes) == set(FEEDBACK_REASON_CODES)
