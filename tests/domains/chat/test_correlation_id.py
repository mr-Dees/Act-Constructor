"""Тесты сквозной трассировки HTTP-запрос → agent_requests → runner.

Покрывают:
- ``AgentBridgeService.send`` пишет ``request_id_var`` в ``parent_request_id``
  при наличии HTTP-контекста.
- При отсутствии контекста (дефолт "-") колонка остаётся NULL.
- Фоновый ``_run`` подхватывает ``parent_request_id`` из БД и проставляет
  в :data:`request_id_var`, благодаря чему все логи раннера несут тот же
  correlation_id, что и исходный HTTP-запрос.
"""
from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import request_id_var
from app.domains.chat.services import agent_bridge_runner
from app.domains.chat.services.agent_bridge import AgentBridgeService
from app.domains.chat.settings import ChatDomainSettings


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    """Мокаем глобальный адаптер, иначе BaseRepository падает на старте."""
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


@pytest.fixture(autouse=True)
def _reset_runner_registry():
    """Очищаем in-process registry раннера между тестами."""
    agent_bridge_runner._running.clear()
    yield
    agent_bridge_runner._running.clear()


@pytest.fixture(autouse=True)
def _reset_request_id():
    """Сбрасываем ContextVar к дефолту между тестами, чтобы значение из
    одного теста не «протекло» в следующий."""
    token = request_id_var.set("-")
    yield
    request_id_var.reset(token)


def _settings() -> ChatDomainSettings:
    return ChatDomainSettings(
        api_base="http://test-llm:8000/v1",
        api_key="test-key",
    )


def _fake_get_db_ctx(conn):
    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=conn)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return MagicMock(return_value=ctx)


# ── AgentBridgeService.send: запись parent_request_id ─────────────────────


async def test_agent_request_persists_parent_request_id(mock_conn):
    """Когда request_id_var выставлен (HTTP-контекст), send пишет его
    в parent_request_id (последний параметр INSERT'а)."""
    token = request_id_var.set("http-req-abc123")
    try:
        svc = AgentBridgeService(mock_conn)
        await svc.send(
            conversation_id="c1",
            message_id="m1",
            user_id="u",
            domain_name="acts",
            knowledge_bases=[],
            last_user_message="Hi",
            history=[],
            files=[],
        )
    finally:
        request_id_var.reset(token)

    mock_conn.execute.assert_called_once()
    sql, *params = mock_conn.execute.call_args.args
    assert "parent_request_id" in sql
    # Параметры: id, conversation_id, message_id, user_id, domain_name,
    # knowledge_bases(jsonb), last_user_message, history, files,
    # parent_request_id — последний.
    assert params[-1] == "http-req-abc123"


async def test_agent_request_persists_null_when_no_context(mock_conn):
    """Когда request_id_var имеет дефолтное "-" (вне HTTP-контекста),
    parent_request_id в INSERT'е — None."""
    # request_id_var уже сброшен фикстурой к "-".
    svc = AgentBridgeService(mock_conn)
    await svc.send(
        conversation_id="c1",
        message_id="m1",
        user_id="u",
        domain_name=None,
        knowledge_bases=[],
        last_user_message="Hi",
        history=[],
        files=[],
    )
    _sql, *params = mock_conn.execute.call_args.args
    assert params[-1] is None


async def test_agent_request_persists_null_when_var_is_none(mock_conn):
    """Граничный кейс: request_id_var.set(None) — тоже NULL."""
    token = request_id_var.set(None)  # type: ignore[arg-type]
    try:
        svc = AgentBridgeService(mock_conn)
        await svc.send(
            conversation_id="c", message_id="m", user_id="u",
            domain_name=None, knowledge_bases=[],
            last_user_message="x", history=[], files=[],
        )
    finally:
        request_id_var.reset(token)
    _sql, *params = mock_conn.execute.call_args.args
    assert params[-1] is None


# ── _run: проставление correlation_id из БД в ContextVar ──────────────────


async def test_runner_propagates_correlation_id_into_context_var(caplog):
    """Раннер читает parent_request_id из строки agent_requests и
    проставляет в request_id_var. Внутри _run все логи несут это значение,
    и фильтр request_id (см. app.core.config) их подхватывает."""
    captured: dict = {}

    # Перехватываем значение ContextVar в момент, когда раннер уже
    # подхватил parent: подменяем wait_for_completion на short-circuit,
    # который читает request_id_var и сразу завершает работу.
    async def fake_wait(self, *a, **kw):
        captured["request_id_inside_runner"] = request_id_var.get()
        # ничего не yield'им — раннер выходит из цикла естественно
        return
        yield  # pragma: no cover  # делаем функцию async-generator'ом

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
        "parent_request_id": "http-req-trace-xyz",
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)

    finalize_msg_mock = AsyncMock(return_value=True)
    start_mock = AsyncMock(return_value={
        "id": "msg-1", "status": "streaming", "content": [],
    })
    fake_msg_repo = MagicMock()
    fake_msg_repo.append_block = AsyncMock(return_value=True)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    # Перед запуском _run значение ContextVar — дефолтное "-".
    assert request_id_var.get() == "-"

    with (
        caplog.at_level(
            logging.INFO,
            logger="audit_workstation.domains.chat.agent_bridge_runner",
        ),
        patch("app.db.connection.get_db", _fake_get_db_ctx(mock_conn)),
        patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ),
        patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository",
            return_value=fake_req_repo,
        ),
        patch(
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    # Внутри runner ContextVar содержал значение parent_request_id из БД.
    assert captured["request_id_inside_runner"] == "http-req-trace-xyz"

    # После выхода _run значение сброшено в дефолт — ContextVar не «протёк».
    assert request_id_var.get() == "-"

    # В логах runner'а зафиксирован подхват correlation_id.
    pickup_logs = [
        rec for rec in caplog.records
        if "подхватили correlation_id" in rec.getMessage()
    ]
    assert pickup_logs, (
        "Ожидался лог с фразой 'подхватили correlation_id', "
        f"но получено: {[r.getMessage() for r in caplog.records]}"
    )
    assert "http-req-trace-xyz" in pickup_logs[0].getMessage()


async def test_runner_does_not_set_context_var_when_parent_is_none():
    """Если parent_request_id в БД = NULL (created вне HTTP-контекста),
    runner не трогает ContextVar — остаётся дефолтное значение."""
    captured: dict = {}

    async def fake_wait(self, *a, **kw):
        captured["request_id_inside_runner"] = request_id_var.get()
        return
        yield  # pragma: no cover

    mock_conn = AsyncMock()
    mock_conn.transaction = MagicMock(return_value=AsyncMock())

    fake_req_repo = MagicMock()
    fake_req_repo.get = AsyncMock(return_value={
        "id": "rid-1",
        "conversation_id": "conv-1",
        "message_id": "msg-1",
        "user_id": "u",
        "status": "pending",
        "version": 1,
        "parent_request_id": None,
    })
    fake_req_repo.update_status = AsyncMock(return_value=2)
    fake_req_repo.finalize = AsyncMock(return_value=True)
    finalize_msg_mock = AsyncMock(return_value=True)
    start_mock = AsyncMock(return_value={
        "id": "msg-1", "status": "streaming", "content": [],
    })
    fake_msg_repo = MagicMock()
    fake_msg_repo.append_block = AsyncMock(return_value=True)
    fake_adapter = MagicMock(get_table_name=lambda n: n)

    with (
        patch("app.db.connection.get_db", _fake_get_db_ctx(mock_conn)),
        patch(
            "app.db.repositories.base.get_adapter", return_value=fake_adapter,
        ),
        patch(
            "app.domains.chat.repositories.agent_request_repository."
            "AgentRequestRepository",
            return_value=fake_req_repo,
        ),
        patch(
            "app.domains.chat.repositories.message_repository."
            "MessageRepository",
            return_value=fake_msg_repo,
        ),
        patch(
            "app.domains.chat.services.agent_bridge."
            "AgentBridgeService.wait_for_completion",
            fake_wait,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.start_streaming_assistant_message",
            start_mock,
        ),
        patch(
            "app.domains.chat.services.message_service."
            "MessageService.finalize_assistant_message",
            finalize_msg_mock,
        ),
    ):
        await agent_bridge_runner._run("rid-1", settings=_settings())

    # ContextVar внутри runner'а остался дефолтным.
    assert captured["request_id_inside_runner"] == "-"


# ── Репозиторий: SQL содержит parent_request_id ──────────────────────────


async def test_agent_request_repository_insert_passes_parent_argument(
    mock_conn,
):
    """Проверяем, что AgentRequestRepository.create корректно прокидывает
    parent_request_id в INSERT (без участия сервиса)."""
    from app.domains.chat.repositories.agent_request_repository import (
        AgentRequestRepository,
    )
    repo = AgentRequestRepository(mock_conn)
    await repo.create(
        id="rid-x",
        conversation_id="c",
        message_id="m",
        user_id="u",
        last_user_message="hi",
        parent_request_id="trace-id-789",
    )
    sql, *params = mock_conn.execute.call_args.args
    assert "parent_request_id" in sql
    assert params[-1] == "trace-id-789"

    # Совместимость: вызов без parent_request_id оставляет NULL.
    mock_conn.execute.reset_mock()
    await repo.create(
        id="rid-y",
        conversation_id="c",
        message_id="m",
        user_id="u",
        last_user_message="hi",
    )
    _sql, *params2 = mock_conn.execute.call_args.args
    assert params2[-1] is None
