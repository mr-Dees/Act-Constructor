"""Тесты сборщика замечаний валидации акта (фича статуса #8)."""

from app.domains.acts.schemas.act_content import ActDataSchema
from app.domains.acts.services.content_validation import (
    collect_validation_issues,
    status_from_issues,
)


def _base_sections():
    """Защищённые разделы 1–5 (валидная базовая структура)."""
    return [
        {"id": str(i), "label": f"Раздел {i}", "type": "item",
         "protected": True, "deletable": False, "children": []}
        for i in range(1, 6)
    ]


def _valid_act(**tables):
    return ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": _base_sections()},
        tables=tables,
        saveType="manual",
    )


def _codes(issues):
    return {i["code"] for i in issues}


def test_valid_structure_no_issues():
    issues = collect_validation_issues(_valid_act())
    assert issues == []
    assert status_from_issues(issues) == "ok"


def test_empty_tree_is_error():
    data = ActDataSchema(tree={"id": "root", "label": "Акт", "children": []}, saveType="manual")
    issues = collect_validation_issues(data)
    assert "empty_structure" in _codes(issues)
    assert status_from_issues(issues) == "error"


def test_missing_base_sections():
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": [
            {"id": "1", "label": "Раздел 1", "type": "item",
             "protected": True, "deletable": False, "children": []},
        ]},
        saveType="manual",
    )
    issues = collect_validation_issues(data)
    assert "missing_sections" in _codes(issues)


def test_unprotected_base_section():
    sections = _base_sections()
    sections[2]["protected"] = False  # раздел 3 раззащищён
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": sections},
        saveType="manual",
    )
    issues = collect_validation_issues(data)
    assert "unprotected_sections" in _codes(issues)


def test_table_without_header_is_error():
    table = {
        "id": "t1", "nodeId": "5",
        "grid": [[{"content": "данные", "isHeader": False}]],
        "colWidths": [100],
    }
    issues = collect_validation_issues(_valid_act(t1=table))
    assert "table_no_header" in _codes(issues)
    assert status_from_issues(issues) == "error"


def test_table_empty_header_is_error():
    table = {
        "id": "t1", "nodeId": "5",
        "grid": [
            [{"content": "", "isHeader": True}],
            [{"content": "данные", "isHeader": False}],
        ],
        "colWidths": [100],
    }
    issues = collect_validation_issues(_valid_act(t1=table))
    assert "table_empty_header" in _codes(issues)


def test_table_no_data_is_warning():
    table = {
        "id": "t1", "nodeId": "5",
        "grid": [[{"content": "Заголовок", "isHeader": True}]],
        "colWidths": [100],
    }
    issues = collect_validation_issues(_valid_act(t1=table))
    assert "table_no_data" in _codes(issues)
    # Только warning-замечание (пустая таблица) → статус 'warning', не 'error'.
    assert status_from_issues(issues) == "warning"


def test_status_from_issues_levels():
    """status_from_issues: error доминирует; только warning → warning; пусто → ok."""
    assert status_from_issues([]) == "ok"
    assert status_from_issues([{"severity": "warning"}]) == "warning"
    assert status_from_issues([{"severity": "error"}]) == "error"
    # Смесь error+warning → error (error доминирует).
    assert status_from_issues([{"severity": "warning"}, {"severity": "error"}]) == "error"


def test_complete_table_no_issues():
    table = {
        "id": "t1", "nodeId": "5",
        "grid": [
            [{"content": "Заголовок", "isHeader": True}],
            [{"content": "значение", "isHeader": False}],
        ],
        "colWidths": [100],
    }
    issues = collect_validation_issues(_valid_act(t1=table))
    assert issues == []


# ── Сервисный уровень: статус сохраняется и шлётся уведомление (#8) ──

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.domains.acts.services.act_content_service import ActContentService


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


def _svc():
    conn = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    acts_settings = MagicMock()
    acts_settings.resource.max_tree_depth = 50
    acts_settings.audit_log.max_diff_elements = 100
    acts_settings.audit_log.max_diff_cells_per_table = 100
    acts_settings.audit_log.max_content_versions = 50
    svc = ActContentService(
        conn=conn, settings=MagicMock(), acts_settings=acts_settings,
        access=MagicMock(), lock=MagicMock(), crud=MagicMock(),
        content=MagicMock(), invoice=MagicMock(),
    )
    svc.guard = MagicMock()
    svc.guard.require_edit_permission = AsyncMock()
    svc.guard.require_lock_owner = AsyncMock()
    saved = {}

    async def _save_content(act_id, data, username, **kwargs):
        saved.update(kwargs)
        return {"status": "success", "message": "ok", "dropped_orphans": 0}

    svc._content = MagicMock()
    svc._content.save_content = AsyncMock(side_effect=_save_content)
    svc._audit = MagicMock()
    svc._audit.log = AsyncMock()
    svc._audit.compute_content_diff = AsyncMock(return_value={})
    svc._audit.compute_field_diffs = AsyncMock(return_value=None)
    svc._versions = MagicMock()
    svc._versions.create_version = AsyncMock(return_value=1)
    svc._crud = MagicMock()
    svc._crud.get_act_by_id = AsyncMock(return_value=MagicMock(km_number="КМ-01-00001"))
    return svc, saved


async def test_valid_act_status_ok_no_notification():
    svc, saved = _svc()
    data = _valid_act()
    with patch(
        "app.domains.acts.services.notifications_producer.emit_act_notification",
        new=AsyncMock(),
    ) as emit:
        result = await svc.save_content(act_id=1, data=data, username="12345")
    assert result["validation_status"] == "ok"
    assert saved["validation_status"] == "ok"
    emit.assert_not_called()


async def test_broken_act_status_error_no_notification():
    """Структурная ошибка фиксирует статус 'error' и замечания, но НЕ создаёт
    персистентного уведомления: на лендинге ошибку показывает серверная сводка
    attention (колокольчик), внутри акта — живой источник validation. Прежний
    error-push убран (дублировал сводку и плодил записи при каждом сохранении)."""
    svc, saved = _svc()
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []}, saveType="manual",
    )
    with patch(
        "app.domains.acts.services.notifications_producer.emit_act_notification",
        new=AsyncMock(),
    ) as emit:
        result = await svc.save_content(act_id=1, data=data, username="12345")
    assert result["validation_status"] == "error"
    assert saved["validation_status"] == "error"
    assert result["validation_issues"]
    emit.assert_not_called()


async def test_broken_act_auto_save_does_not_notify():
    svc, saved = _svc()
    data = ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []}, saveType="auto",
    )
    with patch(
        "app.domains.acts.services.notifications_producer.emit_act_notification",
        new=AsyncMock(),
    ) as emit:
        result = await svc.save_content(act_id=1, data=data, username="12345")
    assert result["validation_status"] == "error"
    emit.assert_not_called()


async def test_warning_act_manual_save_does_not_notify():
    """Статус warning (только пустые таблицы) портальное уведомление НЕ шлёт —
    даже при ручном сохранении: warning не критичен (решение пользователя)."""
    svc, saved = _svc()
    table = {
        "id": "t1", "nodeId": "5",
        "grid": [[{"content": "Заголовок", "isHeader": True}]],
        "colWidths": [100],
    }
    data = _valid_act(t1=table)  # валидная структура + пустая таблица → warning
    with patch(
        "app.domains.acts.services.notifications_producer.emit_act_notification",
        new=AsyncMock(),
    ) as emit:
        result = await svc.save_content(act_id=1, data=data, username="12345")
    assert result["validation_status"] == "warning"
    assert saved["validation_status"] == "warning"
    emit.assert_not_called()
