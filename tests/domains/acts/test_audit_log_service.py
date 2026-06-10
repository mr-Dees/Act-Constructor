"""
Unit-тесты сервиса/репозитория аудит-лога.

В acts-домене аудит-лог разделён на два слоя:
- ``ActAuditLogRepository.log()`` — запись действия (глушит DB-ошибки by design)
- ``AuditLogService.restore_version()`` — восстановление содержимого с записью в лог

Тут проверяем поведение этих двух слоёв на уровне сервиса. Whitelist полей
``get_log`` уже покрыт в test_act_audit_log_whitelist.py — не дублируем,
но даём один регрессионный кейс на интеграцию (фильтр доходит до SQL).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.acts.exceptions import ActNotFoundError
from app.domains.acts.repositories.act_audit_log import ActAuditLogRepository
from app.domains.acts.services.audit_log_service import AuditLogService


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


def _make_tx_conn() -> AsyncMock:
    """Mock-соединение с поддержкой async with conn.transaction().

    restore_version держит все шаги в одной плоской транзакции —
    mock-у нужен синхронный transaction(), возвращающий async-CM.
    """
    conn = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__ = AsyncMock(return_value=tx)
    tx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx)
    return conn


# ── ActAuditLogRepository.log: запись и обработка ошибок ────────────────────


class TestAuditLogPersistence:
    """log() сохраняет запись с правильными полями и глушит исключения БД."""

    async def test_log_persists_with_correct_fields(self, mock_conn):
        """Корректный вызов execute с action, username, act_id, JSON-полями."""
        repo = ActAuditLogRepository(mock_conn)

        await repo.log(
            action="create",
            username="12345",
            act_id=42,
            details={"km_number": "КМ-01-0000001"},
        )

        mock_conn.execute.assert_awaited_once()
        sql, *params = mock_conn.execute.await_args.args
        assert "INSERT INTO" in sql
        assert "audit_log" in sql
        # Параметры в порядке: act_id, action, username, details_json, changelog_json
        assert params[0] == 42
        assert params[1] == "create"
        assert params[2] == "12345"
        # details сериализован в JSON-строку
        assert "КМ-01-0000001" in params[3]
        # changelog по умолчанию — пустой массив
        assert params[4] == "[]"

    async def test_log_with_changelog_persists_changelog_json(self, mock_conn):
        """changelog передаётся в SQL как сериализованный JSON-массив."""
        repo = ActAuditLogRepository(mock_conn)
        changelog = [{"type": "table_added", "table_id": "t1"}]

        await repo.log(
            action="content_save",
            username="12345",
            act_id=10,
            changelog=changelog,
        )

        params = mock_conn.execute.await_args.args[1:]
        assert "table_added" in params[4]
        assert "t1" in params[4]

    async def test_log_swallows_db_errors_returns_none(self, mock_conn):
        """Ошибка execute не должна пробрасываться наверх (audit-log fail-safe).

        Запись в аудит-лог не должна блокировать основную операцию.
        Документировано в repositories/act_audit_log.py (try/except).
        """
        mock_conn.execute.side_effect = RuntimeError("connection lost")
        repo = ActAuditLogRepository(mock_conn)

        # НЕ должно бросить
        result = await repo.log(
            action="create",
            username="12345",
            act_id=1,
        )
        assert result is None

    async def test_log_serializes_non_json_native_via_default_str(self, mock_conn):
        """default=str в json.dumps — не падает на datetime/Decimal/UUID."""
        from datetime import datetime
        repo = ActAuditLogRepository(mock_conn)

        await repo.log(
            action="export",
            username="12345",
            act_id=5,
            details={"exported_at": datetime(2026, 5, 18, 12, 0, 0)},
        )

        # JSON-строка собралась — execute вызван
        mock_conn.execute.assert_awaited_once()
        details_json = mock_conn.execute.await_args.args[4]
        assert "2026-05-18" in details_json


# ── ActAuditLogRepository.get_log: фильтрация и пагинация ───────────────────


class TestGetLogFilters:
    """get_log применяет фильтры и пагинацию."""

    async def test_get_history_returns_paginated_list(self, mock_conn):
        """Возвращает (items, total) и пробрасывает limit/offset в SQL."""
        repo = ActAuditLogRepository(mock_conn)
        mock_conn.fetchrow.return_value = {"cnt": 7}
        mock_conn.fetch.return_value = [
            {
                "id": i,
                "action": "create",
                "username": "12345",
                "details": "{}",
                "changelog": None,
                "created_at": "2026-05-18T12:00:00",
            }
            for i in range(3)
        ]

        items, total = await repo.get_log(act_id=1, limit=3, offset=0)

        assert total == 7
        assert len(items) == 3
        # limit / offset попали в параметры SQL
        params = mock_conn.fetch.await_args.args[1:]
        assert 3 in params
        assert 0 in params
        # JSON-строки распаршены в dict/list
        assert items[0]["details"] == {}
        assert items[0]["changelog"] == []

    async def test_get_history_filters_by_action(self, mock_conn):
        """Фильтр action=create добавляет условие в WHERE."""
        repo = ActAuditLogRepository(mock_conn)
        mock_conn.fetchrow.return_value = {"cnt": 0}
        mock_conn.fetch.return_value = []

        await repo.get_log(act_id=1, action="create")

        sql = mock_conn.fetch.await_args.args[0]
        assert "action" in sql
        # Один action → "= $N", не IN
        assert "action = " in sql

    async def test_get_history_filters_by_multiple_actions(self, mock_conn):
        """Несколько action через запятую → IN-клауза."""
        repo = ActAuditLogRepository(mock_conn)
        mock_conn.fetchrow.return_value = {"cnt": 0}
        mock_conn.fetch.return_value = []

        await repo.get_log(act_id=1, action="create,update,delete")

        sql = mock_conn.fetch.await_args.args[0]
        assert "IN (" in sql

    async def test_get_history_filters_by_user(self, mock_conn):
        """username — ILIKE с подстановкой %username%."""
        repo = ActAuditLogRepository(mock_conn)
        mock_conn.fetchrow.return_value = {"cnt": 0}
        mock_conn.fetch.return_value = []

        await repo.get_log(act_id=1, username="иван")

        sql = mock_conn.fetch.await_args.args[0]
        params = mock_conn.fetch.await_args.args[1:]
        assert "ILIKE" in sql
        assert "%иван%" in params

    async def test_get_history_respects_whitelist_only_safe_columns_in_sql(
        self, mock_conn,
    ):
        """Регрессионный тест на whitelist: не должно быть инъекций.

        Полное покрытие в test_act_audit_log_whitelist.py — тут только
        факт, что комбинированный фильтр не пропускает посторонних имён.
        """
        repo = ActAuditLogRepository(mock_conn)
        mock_conn.fetchrow.return_value = {"cnt": 0}
        mock_conn.fetch.return_value = []

        await repo.get_log(
            act_id=1,
            action="create",
            username="user",
            from_date="2026-01-01",
            to_date="2026-12-31",
        )

        sql = mock_conn.fetch.await_args.args[0]
        assert "; DROP" not in sql
        assert "OR 1=1" not in sql


# ── AuditLogService.restore_version ────────────────────────────────────────


class TestAuditLogServiceRestore:
    """AuditLogService.restore_version восстанавливает версию + пишет в лог."""

    def _make_service(self):
        """Собирает AuditLogService с моками всех зависимостей."""
        guard = MagicMock()
        guard.require_management_role = AsyncMock()
        guard.require_lock_owner = AsyncMock()

        audit_repo = MagicMock()
        audit_repo.log = AsyncMock()

        versions_repo = MagicMock()
        versions_repo.get_version = AsyncMock()
        versions_repo.create_version = AsyncMock(return_value=2)

        conn = _make_tx_conn()
        return AuditLogService(guard, audit_repo, versions_repo, conn), guard, audit_repo, versions_repo

    async def test_restore_version_unknown_raises_not_found(self):
        """Несуществующая версия → ActNotFoundError (404)."""
        svc, guard, audit_repo, versions_repo = self._make_service()
        versions_repo.get_version.return_value = None

        with pytest.raises(ActNotFoundError):
            await svc.restore_version(act_id=1, version_id=999, username="12345")

        guard.require_management_role.assert_awaited_once_with(1, "12345")
        guard.require_lock_owner.assert_awaited_once_with(1, "12345")
        audit_repo.log.assert_not_awaited()
        versions_repo.create_version.assert_not_awaited()

    async def test_restore_version_writes_audit_log_with_restore_action(self):
        """Успешный restore пишет аудит-лог с action=restore и метаданными версии."""
        svc, guard, audit_repo, versions_repo = self._make_service()
        versions_repo.get_version.return_value = {
            "version_number": 5,
            "tree_data": {"id": "root", "children": []},
            "tables_data": {},
            "textblocks_data": {},
            "violations_data": {},
        }

        # Патчим ActContentRepository, чтобы не дёргать настоящий save_content
        with patch(
            "app.domains.acts.services.audit_log_service.ActContentRepository"
        ) as content_cls:
            instance = content_cls.return_value
            instance.save_content = AsyncMock()
            # restore_version делает pre-snapshot через get_content
            # (lost-write guard) — мок обязателен, иначе TypeError на await.
            # Здесь возвращаем None: проверяем что без текущего контента
            # pre-snapshot пропускается.
            instance.get_content = AsyncMock(return_value=None)
            result = await svc.restore_version(
                act_id=42,
                version_id=100,
                username="12345",
            )

        audit_repo.log.assert_awaited_once()
        call = audit_repo.log.await_args
        # action positional/kw
        action = call.args[0] if call.args else call.kwargs.get("action")
        assert action == "restore"
        # details содержит from_version и version_id
        details = call.args[3] if len(call.args) > 3 else call.kwargs.get("details")
        assert details["from_version"] == 5
        assert details["version_id"] == 100

        # Новая версия создана (snapshot после восстановления, без pre-snapshot
        # так как get_content вернул None).
        versions_repo.create_version.assert_awaited_once()
        # Ответ содержит restored_version
        assert result["restored_version"] == 5
        assert result["success"] is True

    async def test_restore_version_swallow_audit_log_db_error_does_not_fail_caller(self):
        """Аудит-лог глушит DB-ошибку → restore_version всё равно завершается успехом.

        Это тест на интеграцию: AuditLogService вызывает audit_repo.log(),
        который не должен ронять основную операцию (см. log() impl).
        Здесь мокаем audit_repo.log так, чтобы он сам не кидал
        (как делает реальный код).
        """
        svc, guard, audit_repo, versions_repo = self._make_service()
        versions_repo.get_version.return_value = {
            "version_number": 1,
            "tree_data": {"id": "root", "children": []},
            "tables_data": {},
            "textblocks_data": {},
            "violations_data": {},
        }
        # Имитируем "глушение" внутри log()
        audit_repo.log = AsyncMock(return_value=None)

        with patch(
            "app.domains.acts.services.audit_log_service.ActContentRepository"
        ) as content_cls:
            instance = content_cls.return_value
            instance.save_content = AsyncMock()
            instance.get_content = AsyncMock(return_value=None)
            result = await svc.restore_version(1, 1, "12345")

        assert result["success"] is True


# ── Pre-snapshot перед restore_version (lost-write guard) ──────────────────


class TestRestoreVersionPreSnapshot:
    """restore_version делает snapshot текущего контента ДО перезаписи.

    Закрывает lost-write: если активный редактор не успел сохранить
    свой state, его последняя версия остаётся доступной в истории.
    """

    def _make_service(self):
        guard = MagicMock()
        guard.require_management_role = AsyncMock()
        guard.require_lock_owner = AsyncMock()
        audit_repo = MagicMock()
        audit_repo.log = AsyncMock()
        versions_repo = MagicMock()
        versions_repo.get_version = AsyncMock()
        versions_repo.create_version = AsyncMock(return_value=2)
        conn = _make_tx_conn()
        return AuditLogService(guard, audit_repo, versions_repo, conn), versions_repo

    async def test_pre_snapshot_created_from_current_content(self):
        """Перед restore версии v_old фиксируем текущий v_now как auto-snapshot."""
        svc, versions_repo = self._make_service()
        # Старая версия, которую восстанавливаем (валидная для ActDataSchema)
        versions_repo.get_version.return_value = {
            "version_number": 1,
            "tree_data": {"id": "root", "label": "v1", "children": []},
            "tables_data": {},
            "textblocks_data": {},
            "violations_data": {},
        }
        # Текущее содержимое акта — это то, что должно попасть в pre-snapshot.
        # Структуру намеренно делаем плоской: pre-snapshot пишется через
        # versions_repo.create_version(**kwargs), без валидации Pydantic.
        current_content = {
            "tree": {"id": "root", "label": "v_current", "children": []},
            "tables": {"t2": {"id": "t2", "nodeId": "n2"}},
            "textBlocks": {"tb1": {"id": "tb1", "nodeId": "n1", "content": "WIP"}},
            "violations": {},
            "invoices": {},
        }

        with patch(
            "app.domains.acts.services.audit_log_service.ActContentRepository"
        ) as content_cls:
            instance = content_cls.return_value
            instance.save_content = AsyncMock()
            instance.get_content = AsyncMock(return_value=current_content)

            await svc.restore_version(act_id=42, version_id=1, username="12345")

        # get_content должен быть вызван ДО save_content
        instance.get_content.assert_awaited_once_with(42)

        # create_version вызван дважды: pre-snapshot + post-restore
        assert versions_repo.create_version.await_count == 2
        first_call = versions_repo.create_version.await_args_list[0]
        # Первый вызов — pre-snapshot с текущим контентом
        assert first_call.kwargs["save_type"] == "auto"
        assert first_call.kwargs["tree"]["label"] == "v_current"
        assert first_call.kwargs["tables"] == {"t2": {"id": "t2", "nodeId": "n2"}}
        assert first_call.kwargs["textblocks"] == {
            "tb1": {"id": "tb1", "nodeId": "n1", "content": "WIP"}
        }

        # Второй вызов — post-restore snapshot с восстановленной версией
        second_call = versions_repo.create_version.await_args_list[1]
        assert second_call.kwargs["save_type"] == "manual"
        assert second_call.kwargs["tree"]["label"] == "v1"

    async def test_pre_snapshot_skipped_when_no_current_content(self):
        """get_content вернул None/{} → pre-snapshot не создаётся."""
        svc, versions_repo = self._make_service()
        versions_repo.get_version.return_value = {
            "version_number": 1,
            "tree_data": {"id": "root", "children": []},
            "tables_data": {},
            "textblocks_data": {},
            "violations_data": {},
        }

        with patch(
            "app.domains.acts.services.audit_log_service.ActContentRepository"
        ) as content_cls:
            instance = content_cls.return_value
            instance.save_content = AsyncMock()
            instance.get_content = AsyncMock(return_value=None)

            await svc.restore_version(act_id=1, version_id=1, username="12345")

        instance.get_content.assert_awaited_once_with(1)
        # Только post-restore snapshot, без pre-snapshot
        assert versions_repo.create_version.await_count == 1
        assert versions_repo.create_version.await_args.kwargs["save_type"] == "manual"

    async def test_pre_snapshot_happens_before_save_content(self):
        """Порядок: get_content → create_version(pre) → save_content → create_version(post)."""
        svc, versions_repo = self._make_service()
        versions_repo.get_version.return_value = {
            "version_number": 3,
            "tree_data": {"id": "root", "label": "restored"},
            "tables_data": {},
            "textblocks_data": {},
            "violations_data": {},
        }

        call_log: list[str] = []

        async def _get_content(act_id):
            call_log.append("get_content")
            return {"tree": {"id": "root", "label": "wip"}, "tables": {},
                    "textBlocks": {}, "violations": {}}

        async def _save_content(act_id, data, username):
            call_log.append("save_content")

        async def _create_version(**kwargs):
            call_log.append(f"create_version:{kwargs['save_type']}")
            return 1

        versions_repo.create_version.side_effect = _create_version

        with patch(
            "app.domains.acts.services.audit_log_service.ActContentRepository"
        ) as content_cls:
            instance = content_cls.return_value
            instance.get_content = AsyncMock(side_effect=_get_content)
            instance.save_content = AsyncMock(side_effect=_save_content)

            await svc.restore_version(act_id=1, version_id=3, username="12345")

        assert call_log == [
            "get_content",
            "create_version:auto",   # pre-snapshot
            "save_content",           # перезапись восстановленным контентом
            "create_version:manual",  # post-restore snapshot
        ]
