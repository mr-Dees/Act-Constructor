"""Тесты классификатора маршрута/исхода ответа ассистента."""

from app.domains.chat.services import route_classifier as rc


def _msg(**kw):
    base = {
        "id": "m1",
        "conversation_id": "c1",
        "role": "assistant",
        "content": [{"type": "text", "content": "Привет"}],
        "agent_ref": None,
        "status": "complete",
    }
    base.update(kw)
    return base


def test_classify_kb_agent_when_agent_ref_set():
    """agent_ref задан → форвард во внешнего БЗ-агента."""
    assert rc.classify_route(_msg(agent_ref="q-uid")) == rc.ROUTE_KB_AGENT


def test_classify_kb_agent_priority_over_blocks():
    """agent_ref имеет приоритет над типами блоков."""
    msg = _msg(
        agent_ref="q-uid",
        content=[{"type": "client_action", "action": "open_url"}],
    )
    assert rc.classify_route(msg) == rc.ROUTE_KB_AGENT


def test_classify_non_kb_llm_on_client_action():
    """Блок client_action → локальный action-tool."""
    msg = _msg(content=[
        {"type": "text", "content": "Открываю"},
        {"type": "client_action", "action": "open_url"},
    ])
    assert rc.classify_route(msg) == rc.ROUTE_NON_KB_LLM


def test_classify_non_kb_llm_on_buttons():
    """Блок buttons → локальный action-tool."""
    msg = _msg(content=[{"type": "buttons", "buttons": []}])
    assert rc.classify_route(msg) == rc.ROUTE_NON_KB_LLM


def test_classify_smalltalk_on_text_only():
    """Только текстовый блок → small-talk / локальный текстовый ответ."""
    assert rc.classify_route(_msg()) == rc.ROUTE_SMALLTALK


def test_classify_unknown_for_user_message():
    """Не-assistant сообщение → unknown."""
    assert rc.classify_route(_msg(role="user")) == rc.ROUTE_UNKNOWN


def test_classify_robust_to_garbage_content():
    """Мусор в content не ломает классификатор."""
    assert rc.classify_route(_msg(content=None)) == rc.ROUTE_SMALLTALK
    assert rc.classify_route(_msg(content="не список")) == rc.ROUTE_SMALLTALK
    assert rc.classify_route(_msg(content=[None, 42, {"no": "type"}])) == rc.ROUTE_SMALLTALK


def test_outcome_error_on_failed_status():
    assert rc.outcome(_msg(status="failed")) == rc.OUTCOME_ERROR


def test_outcome_error_on_error_block():
    msg = _msg(content=[{"type": "error", "message": "boom"}])
    assert rc.outcome(msg) == rc.OUTCOME_ERROR


def test_outcome_ok_on_complete_text():
    assert rc.outcome(_msg()) == rc.OUTCOME_OK


def test_tool_block_types_synced_with_block_registry():
    """Guard состава _TOOL_BLOCK_TYPES: ловит переименование и случайное
    удаление (пропущенный тип молча классифицируется как smalltalk и
    искажает аналитику by_route).

    «Tool-invoking» — семантическое свойство, автоматически из MessageBlock
    union его не вывести, поэтому при добавлении нового tool-invoking блока
    (чек-лист «новый тип блока» в CLAUDE.md / dev-guide) обнови И
    _TOOL_BLOCK_TYPES, И этот тест. Заодно проверяем, что каждое имя из
    множества — реальный тип из реестра блоков (опечатка не пройдёт).
    """
    from app.core.chat.blocks import ButtonGroup, ClientActionBlock

    assert rc._TOOL_BLOCK_TYPES == {"client_action", "buttons"}
    registered_types = {
        ButtonGroup.model_fields["type"].default,
        ClientActionBlock.model_fields["type"].default,
    }
    assert rc._TOOL_BLOCK_TYPES == registered_types
