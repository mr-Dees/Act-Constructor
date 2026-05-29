"""
XSS-санитизация content-полей акта на бэкенде.

Гарантирует, что ActContentService.save_content вычищает опасные
теги/атрибуты до записи в БД: <script>, <img onerror>, <svg onload>,
<iframe srcdoc>, javascript:-URL. Whitelist разрешает p/b/i/span/a/...
и атрибуты {a:href,title; span:class,style; div:class; *:class}.

Тесты дополнительно покрывают utils/html_sanitizer.sanitize_html
напрямую (быстрые сценарии без поднятия сервиса).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.domains.acts.schemas.act_content import (
    ActDataSchema,
    TextBlockSchema,
    ViolationSchema,
    ViolationOptionalFieldSchema,
    ViolationAdditionalContentSchema,
    ViolationContentItemSchema,
)
from app.domains.acts.services.act_content_service import ActContentService
from app.domains.acts.utils.html_sanitizer import sanitize_html


@pytest.fixture(autouse=True)
def _patch_adapter(mock_adapter):
    """Все репозитории, создающиеся внутри сервиса, должны получить мок-адаптер."""
    with patch("app.db.repositories.base.get_adapter", return_value=mock_adapter):
        yield


# ── Прямые тесты утилиты sanitize_html ──────────────────────────────────────


class TestSanitizeHtmlDirect:
    """sanitize_html: whitelist тегов/атрибутов/протоколов."""

    def test_strips_script_tag(self):
        out = sanitize_html("<p>safe</p><script>alert(1)</script>")
        # bleach strip=True убирает теги; текст между ними остаётся как plain
        # text — это безопасно: без <script>-обёртки `alert(1)` не выполнится
        # при рендере через innerHTML.
        assert "<script" not in out
        assert "</script" not in out
        assert "safe" in out

    def test_strips_img_onerror(self):
        out = sanitize_html('<img src="x" onerror="alert(1)">')
        # <img> вообще не в whitelist → выкидывается целиком
        assert "<img" not in out
        assert "onerror" not in out

    def test_strips_svg_onload(self):
        out = sanitize_html('<svg onload="alert(1)"><circle/></svg>')
        assert "<svg" not in out
        assert "onload" not in out

    def test_strips_iframe_srcdoc(self):
        out = sanitize_html('<iframe srcdoc="<script>alert(1)</script>"></iframe>')
        assert "<iframe" not in out
        assert "srcdoc" not in out

    def test_strips_event_handlers_on_allowed_tags(self):
        out = sanitize_html('<a href="https://ok" onclick="alert(1)">link</a>')
        assert "onclick" not in out
        assert "href" in out
        assert "link" in out

    def test_blocks_javascript_protocol(self):
        out = sanitize_html('<a href="javascript:alert(1)">x</a>')
        # bleach убирает href со схемой не из whitelist, текст остаётся
        assert "javascript:" not in out
        assert "x" in out

    def test_preserves_allowed_tags(self):
        html = '<p>para</p><b>bold</b><i>it</i><span class="hl">s</span>'
        out = sanitize_html(html)
        assert "<p>" in out
        assert "<b>" in out
        assert "<i>" in out
        assert 'class="hl"' in out

    def test_preserves_allowed_anchor_with_https(self):
        out = sanitize_html('<a href="https://example.com" title="t">x</a>')
        assert 'href="https://example.com"' in out
        assert 'title="t"' in out

    def test_empty_and_none_inputs(self):
        assert sanitize_html("") == ""
        assert sanitize_html(None) == ""

    def test_non_string_falls_back_to_str(self):
        # Защитный fallback (на случай если Pydantic пропустил неожиданный тип)
        assert sanitize_html(123) == "123"


# ── Интеграция: ActContentService.save_content санитизирует все поля ────────


def _make_service():
    """ActContentService с замоканными guard/репозиториями."""
    conn = AsyncMock()
    settings = MagicMock()
    acts_settings = MagicMock()
    acts_settings.resource.max_tree_depth = 20
    acts_settings.audit_log.max_diff_elements = 100
    acts_settings.audit_log.max_diff_cells_per_table = 100
    acts_settings.audit_log.max_content_versions = 50

    access = MagicMock()
    lock = MagicMock()
    crud = MagicMock()
    content = MagicMock()
    content.save_content = AsyncMock(return_value={"status": "success"})
    invoice = MagicMock()

    svc = ActContentService(
        conn=conn,
        settings=settings,
        acts_settings=acts_settings,
        access=access,
        lock=lock,
        crud=crud,
        content=content,
        invoice=invoice,
    )

    # Все проверки доступа / лока — no-op
    svc.guard = MagicMock()
    svc.guard.require_edit_permission = AsyncMock()
    svc.guard.require_lock_owner = AsyncMock()

    # Аудит и версии — no-op
    svc._audit = MagicMock()
    svc._audit.log = AsyncMock()
    svc._audit.compute_content_diff = AsyncMock(return_value={})
    svc._audit.compute_field_diffs = AsyncMock(return_value=None)
    svc._versions = MagicMock()
    svc._versions.create_version = AsyncMock()

    return svc, content


def _data_with_textblock(html: str) -> ActDataSchema:
    return ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []},
        textBlocks={"tb1": TextBlockSchema(id="tb1", nodeId="n1", content=html)},
        saveType="auto",
    )


def _data_with_violation(*, violated="", established="",
                          add_item_html="", field_html="") -> ActDataSchema:
    v = ViolationSchema(
        id="v1",
        nodeId="n1",
        violated=violated,
        established=established,
        additionalContent=ViolationAdditionalContentSchema(
            enabled=True,
            items=[ViolationContentItemSchema(
                id="i1", type="freeText", content=add_item_html,
            )],
        ),
        reasons=ViolationOptionalFieldSchema(enabled=True, content=field_html),
        consequences=ViolationOptionalFieldSchema(enabled=True, content=field_html),
        responsible=ViolationOptionalFieldSchema(enabled=True, content=field_html),
        recommendations=ViolationOptionalFieldSchema(enabled=True, content=field_html),
    )
    return ActDataSchema(
        tree={"id": "root", "label": "Акт", "children": []},
        violations={"v1": v},
        saveType="auto",
    )


class TestSaveContentSanitizesTextBlocks:
    """save_content → textBlock.content прогоняется через sanitize_html."""

    async def test_script_tag_stripped_in_textblock(self):
        svc, content_repo = _make_service()
        payload = "<p>ok</p><script>alert('xss')</script>"
        data = _data_with_textblock(payload)

        await svc.save_content(act_id=1, data=data, username="12345")

        # Проверяем что в save_content репозитория ушёл уже очищенный data
        content_repo.save_content.assert_awaited_once()
        saved_data = content_repo.save_content.await_args.kwargs.get("data") \
            or content_repo.save_content.await_args.args[1]
        sanitized = saved_data.textBlocks["tb1"].content
        # Теги вырезаны; внутренний текст остаётся как plain — не исполнится
        # при innerHTML без <script>-обёртки.
        assert "<script" not in sanitized
        assert "</script" not in sanitized
        assert "ok" in sanitized

    async def test_img_onerror_stripped_in_textblock(self):
        svc, content_repo = _make_service()
        data = _data_with_textblock('<img src=x onerror="alert(1)">')

        await svc.save_content(act_id=1, data=data, username="12345")

        sanitized = data.textBlocks["tb1"].content
        assert "onerror" not in sanitized
        assert "<img" not in sanitized

    async def test_svg_onload_stripped_in_textblock(self):
        svc, content_repo = _make_service()
        data = _data_with_textblock('<svg onload="alert(1)"></svg>')

        await svc.save_content(act_id=1, data=data, username="12345")

        sanitized = data.textBlocks["tb1"].content
        assert "<svg" not in sanitized
        assert "onload" not in sanitized

    async def test_iframe_srcdoc_stripped_in_textblock(self):
        svc, content_repo = _make_service()
        data = _data_with_textblock('<iframe srcdoc="<script>alert(1)</script>"></iframe>')

        await svc.save_content(act_id=1, data=data, username="12345")

        sanitized = data.textBlocks["tb1"].content
        assert "<iframe" not in sanitized
        assert "srcdoc" not in sanitized

    async def test_safe_html_preserved(self):
        """Plain text + базовые теги должны пройти насквозь — regression на e2e."""
        svc, content_repo = _make_service()
        safe = '<p>Hello <b>world</b> <a href="https://example.com">link</a></p>'
        data = _data_with_textblock(safe)

        await svc.save_content(act_id=1, data=data, username="12345")

        sanitized = data.textBlocks["tb1"].content
        assert "<p>" in sanitized
        assert "<b>world</b>" in sanitized
        assert 'href="https://example.com"' in sanitized


class TestSaveContentSanitizesViolations:
    """save_content → все HTML-поля violation чистятся."""

    async def test_violated_and_established_sanitized(self):
        svc, _ = _make_service()
        data = _data_with_violation(
            violated="<p>ok</p><script>x</script>",
            established='<img onerror="x" src=y>',
        )

        await svc.save_content(act_id=1, data=data, username="12345")

        v = data.violations["v1"]
        assert "<script" not in v.violated
        assert "ok" in v.violated
        assert "onerror" not in v.established
        assert "<img" not in v.established

    async def test_additional_content_items_sanitized(self):
        svc, _ = _make_service()
        data = _data_with_violation(
            add_item_html='<p>note</p><iframe srcdoc="x"></iframe>',
        )

        await svc.save_content(act_id=1, data=data, username="12345")

        item = data.violations["v1"].additionalContent.items[0]
        assert "<iframe" not in item.content
        assert "note" in item.content

    async def test_optional_fields_sanitized(self):
        """reasons/consequences/responsible/recommendations.content тоже чистятся."""
        svc, _ = _make_service()
        bad = '<p>r</p><svg onload="alert(1)"></svg>'
        data = _data_with_violation(field_html=bad)

        await svc.save_content(act_id=1, data=data, username="12345")

        v = data.violations["v1"]
        for fname in ("reasons", "consequences", "responsible", "recommendations"):
            content = getattr(v, fname).content
            assert "<svg" not in content
            assert "onload" not in content
            assert "r" in content


class TestSaveContentSanitizesTreeNodes:
    """save_content → tree nodes[*].content рекурсивно чистится."""

    async def test_root_and_nested_node_content_sanitized(self):
        svc, _ = _make_service()
        tree = {
            "id": "root",
            "label": "Акт",
            "content": '<p>r</p><script>alert(1)</script>',
            "children": [
                {
                    "id": "child1",
                    "label": "Раздел",
                    "content": '<img onerror="x" src=y>',
                    "children": [
                        {
                            "id": "leaf",
                            "label": "Пункт",
                            "content": '<iframe srcdoc="x"></iframe>safe',
                            "children": [],
                        }
                    ],
                }
            ],
        }
        data = ActDataSchema(tree=tree, saveType="auto")

        await svc.save_content(act_id=1, data=data, username="12345")

        assert "<script" not in data.tree["content"]
        assert "r" in data.tree["content"]
        child = data.tree["children"][0]
        assert "onerror" not in child["content"]
        assert "<img" not in child["content"]
        leaf = child["children"][0]
        assert "<iframe" not in leaf["content"]
        assert "safe" in leaf["content"]

    async def test_node_without_content_does_not_break(self):
        svc, _ = _make_service()
        tree = {"id": "root", "label": "Акт", "children": [
            {"id": "c", "label": "x", "children": []}  # нет ключа content
        ]}
        data = ActDataSchema(tree=tree, saveType="auto")
        await svc.save_content(act_id=1, data=data, username="12345")
        # Не упало — достаточно
