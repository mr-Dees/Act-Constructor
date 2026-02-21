# File Mapping: Structural Refactoring

**Date:** 2026-02-22
**Reference:** [Design](2026-02-22-structural-refactoring-design.md) | [Plan](2026-02-22-structural-refactoring-plan.md)
**Branch:** refactor/service-architecture

This document lists every file in the project with its old path, new path, and action.
Actions: `move`, `unchanged`, `new`, `delete`, `modify`.

All paths are relative to project root (`D:\PROJECT\Pyton\Act Constructor`).

---

## 1. JavaScript Files (`static/js/`)

### 1.1 Shared (cross-cutting, used by all pages)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/js/app-config.js` | `static/js/shared/app-config.js` | move |
| `static/js/auth.js` | `static/js/shared/auth.js` | move |
| `static/js/api.js` | `static/js/shared/api.js` | move |
| `static/js/notifications.js` | `static/js/shared/notifications.js` | move |
| `static/js/chat-manager.js` | `static/js/shared/chat/chat-manager.js` | move |
| `static/js/chat-modal.js` | `static/js/shared/chat/chat-modal.js` | move |
| `static/js/dialog/dialog-base.js` | `static/js/shared/dialog/dialog-base.js` | move |
| `static/js/dialog/dialog-confirm.js` | `static/js/shared/dialog/dialog-confirm.js` | move |

### 1.2 Portal (sidebar-layout pages)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/js/landing-sidebar.js` | `static/js/portal/portal-sidebar.js` | move |
| `static/js/landing-settings.js` | `static/js/portal/portal-settings.js` | move |
| `static/js/landing-page.js` | `static/js/portal/landing/landing-page.js` | move |
| `static/js/acts-manager-page.js` | `static/js/portal/acts-manager/acts-manager-page.js` | move |
| `static/js/dialog/dialog-create-act.js` | `static/js/portal/acts-manager/dialog-create-act.js` | move |

### 1.3 Constructor (act editor)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/js/app.js` | `static/js/constructor/app.js` | move |
| `static/js/lock-manager.js` | `static/js/constructor/lock-manager.js` | move |
| `static/js/storage-manager.js` | `static/js/constructor/storage-manager.js` | move |
| `static/js/navigation-manager.js` | `static/js/constructor/navigation-manager.js` | move |
| **Header** | | |
| `static/js/header-exit.js` | `static/js/constructor/header/header-exit.js` | move |
| `static/js/acts-menu.js` | `static/js/constructor/header/acts-menu.js` | move |
| `static/js/format-menu-manager.js` | `static/js/constructor/header/format-menu-manager.js` | move |
| `static/js/preview-menu.js` | `static/js/constructor/header/preview-menu.js` | move |
| `static/js/settings-menu.js` | `static/js/constructor/header/settings-menu.js` | move |
| **State** | | |
| `static/js/state/state-core.js` | `static/js/constructor/state/state-core.js` | move |
| `static/js/state/state-tree.js` | `static/js/constructor/state/state-tree.js` | move |
| `static/js/state/state-content.js` | `static/js/constructor/state/state-content.js` | move |
| **Tree** | | |
| `static/js/tree/tree-core.js` | `static/js/constructor/tree/tree-core.js` | move |
| `static/js/tree/tree-renderer.js` | `static/js/constructor/tree/tree-renderer.js` | move |
| `static/js/tree/tree-drag-drop.js` | `static/js/constructor/tree/tree-drag-drop.js` | move |
| `static/js/tree/tree-utils.js` | `static/js/constructor/tree/tree-utils.js` | move |
| **Items** | | |
| `static/js/items/items-renderer.js` | `static/js/constructor/items/items-renderer.js` | move |
| `static/js/items/items-title-editing.js` | `static/js/constructor/items/items-title-editing.js` | move |
| **Table** | | |
| `static/js/table/table-core.js` | `static/js/constructor/table/table-core.js` | move |
| `static/js/table/table-cells-operations.js` | `static/js/constructor/table/table-cells-operations.js` | move |
| `static/js/table/table-sizes.js` | `static/js/constructor/table/table-sizes.js` | move |
| **Textblock** | | |
| `static/js/textblock/textblock-core.js` | `static/js/constructor/textblock/textblock-core.js` | move |
| `static/js/textblock/textblock-editor.js` | `static/js/constructor/textblock/textblock-editor.js` | move |
| `static/js/textblock/textblock-formatting.js` | `static/js/constructor/textblock/textblock-formatting.js` | move |
| `static/js/textblock/textblock-toolbar.js` | `static/js/constructor/textblock/textblock-toolbar.js` | move |
| `static/js/textblock/textblock-links-footnotes.js` | `static/js/constructor/textblock/textblock-links-footnotes.js` | move |
| **Violation** | | |
| `static/js/violation/violation-core.js` | `static/js/constructor/violation/violation-core.js` | move |
| `static/js/violation/violation-rendering.js` | `static/js/constructor/violation/violation-rendering.js` | move |
| `static/js/violation/violation-init.js` | `static/js/constructor/violation/violation-init.js` | move |
| `static/js/violation/violation-paste.js` | `static/js/constructor/violation/violation-paste.js` | move |
| `static/js/violation/violation-drag-drop.js` | `static/js/constructor/violation/violation-drag-drop.js` | move |
| `static/js/violation/violation-additional-content.js` | `static/js/constructor/violation/violation-additional-content.js` | move |
| `static/js/violation/violation-file-upload.js` | `static/js/constructor/violation/violation-file-upload.js` | move |
| **Preview** | | |
| `static/js/preview/preview.js` | `static/js/constructor/preview/preview.js` | move |
| `static/js/preview/preview-table-renderer.js` | `static/js/constructor/preview/preview-table-renderer.js` | move |
| `static/js/preview/preview-textblock-renderer.js` | `static/js/constructor/preview/preview-textblock-renderer.js` | move |
| `static/js/preview/preview-violation-renderer.js` | `static/js/constructor/preview/preview-violation-renderer.js` | move |
| **Context Menu** | | |
| `static/js/context-menu/context-menu-core.js` | `static/js/constructor/context-menu/context-menu-core.js` | move |
| `static/js/context-menu/context-menu-tree.js` | `static/js/constructor/context-menu/context-menu-tree.js` | move |
| `static/js/context-menu/context-menu-cells.js` | `static/js/constructor/context-menu/context-menu-cells.js` | move |
| `static/js/context-menu/context-menu-violation.js` | `static/js/constructor/context-menu/context-menu-violation.js` | move |
| `static/js/context-menu/context-menu-links-footnotes.js` | `static/js/constructor/context-menu/context-menu-links-footnotes.js` | move |
| **Dialog (constructor-specific)** | | |
| `static/js/dialog/dialog-help.js` | `static/js/constructor/dialog/dialog-help.js` | move |
| `static/js/dialog/dialog-invoice.js` | `static/js/constructor/dialog/dialog-invoice.js` | move |
| **Validation** | | |
| `static/js/validation/validation.js` | `static/js/constructor/validation/validation.js` | move |
| `static/js/validation/validation-core.js` | `static/js/constructor/validation/validation-core.js` | move |
| `static/js/validation/validation-act.js` | `static/js/constructor/validation/validation-act.js` | move |
| `static/js/validation/validation-table.js` | `static/js/constructor/validation/validation-table.js` | move |
| `static/js/validation/validation-tree.js` | `static/js/constructor/validation/validation-tree.js` | move |
| **Services** | | |
| `static/js/services/id-generator.js` | `static/js/constructor/services/id-generator.js` | move |

### 1.4 JS Summary

| Category | File Count |
|----------|-----------|
| Shared | 8 |
| Portal | 5 |
| Constructor | 50 |
| **Total JS files** | **63** |

---

## 2. CSS Files (`static/css/`)

### 2.1 Base (foundation, stays in place)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/css/base/variables.css` | `static/css/base/variables.css` | unchanged |
| `static/css/base/reset.css` | `static/css/base/reset.css` | unchanged |
| `static/css/base/animations.css` | `static/css/base/animations.css` | unchanged |
| `static/css/base/auth.css` | `static/css/base/auth.css` | unchanged |
| `static/css/base/read-only.css` | `static/css/constructor/utilities/read-only.css` | move |

### 2.2 Shared (cross-cutting component styles)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/css/modules/buttons/buttons-base.css` | `static/css/shared/buttons/buttons-base.css` | move |
| `static/css/modules/buttons/buttons-action.css` | `static/css/shared/buttons/buttons-action.css` | move |
| `static/css/modules/notifications/notifications-base.css` | `static/css/shared/notifications/notifications-base.css` | move |
| `static/css/modules/notifications/notifications-types.css` | `static/css/shared/notifications/notifications-types.css` | move |
| `static/css/modules/notifications/notifications-content.css` | `static/css/shared/notifications/notifications-content.css` | move |
| `static/css/modules/dialog/dialog.css` | `static/css/shared/dialog/dialog.css` | move |
| `static/css/modules/dialog/dialog-overlay.css` | `static/css/shared/dialog/dialog-overlay.css` | move |
| `static/css/modules/dialog/dialog-buttons.css` | `static/css/shared/dialog/dialog-buttons.css` | move |
| _(no separate file exists)_ | `static/css/shared/chat/chat.css` | new |

> **Note:** Chat styles are currently embedded in `modules/landing/landing.css`. A `chat.css` file must be extracted or created as a minimal stub during Phase 2. The specific styles to extract will be identified during CSS migration.

### 2.3 Portal (sidebar-layout pages)

| Old Path | New Path | Action |
|----------|----------|--------|
| `static/css/modules/landing/landing-sidebar.css` | `static/css/portal/layout/sidebar.css` | move |
| `static/css/layout/settings-menu.css` | `static/css/portal/layout/settings-menu.css` | move |
| _(extracted from landing.css)_ | `static/css/portal/layout/topbar.css` | new |
| `static/css/modules/landing/landing.css` | `static/css/portal/landing/landing.css` | move |
| `static/css/modules/acts-manager/acts-manager-base.css` | `static/css/portal/acts-manager/acts-manager-base.css` | move |
| `static/css/modules/acts-manager/acts-manager-cards.css` | `static/css/portal/acts-manager/acts-manager-cards.css` | move |
| `static/css/modules/acts-manager/acts-menu.css` | `static/css/portal/acts-manager/acts-menu.css` | move |
| `static/css/modules/acts-manager/acts-modal.css` | `static/css/portal/acts-manager/acts-modal.css` | move |

> **Note:** `topbar.css` is a new file. Topbar styles are currently part of `modules/landing/landing.css`. If the styles cannot be cleanly separated, `topbar.css` can start as an empty file and the styles will remain in `portal/landing/landing.css`.

### 2.4 Constructor

| Old Path | New Path | Action |
|----------|----------|--------|
| **Layout** | | |
| `static/css/layout/container.css` | `static/css/constructor/layout/container.css` | move |
| `static/css/layout/header.css` | `static/css/constructor/layout/header.css` | move |
| `static/css/layout/header-actions.css` | `static/css/constructor/layout/header-actions.css` | move |
| `static/css/layout/two-columns.css` | `static/css/constructor/layout/two-columns.css` | move |
| `static/css/layout/panels.css` | `static/css/constructor/layout/panels.css` | move |
| **Tree** | | |
| `static/css/modules/tree/tree-base.css` | `static/css/constructor/tree/tree-base.css` | move |
| `static/css/modules/tree/tree-nodes.css` | `static/css/constructor/tree/tree-nodes.css` | move |
| `static/css/modules/tree/tree-children.css` | `static/css/constructor/tree/tree-children.css` | move |
| `static/css/modules/tree/tree-drag-drop.css` | `static/css/constructor/tree/tree-drag-drop.css` | move |
| `static/css/modules/tree/tree-states.css` | `static/css/constructor/tree/tree-states.css` | move |
| **Table** | | |
| `static/css/modules/table/table-base.css` | `static/css/constructor/table/table-base.css` | move |
| `static/css/modules/table/table-states.css` | `static/css/constructor/table/table-states.css` | move |
| `static/css/modules/table/table-resize.css` | `static/css/constructor/table/table-resize.css` | move |
| `static/css/modules/table/table-editor.css` | `static/css/constructor/table/table-editor.css` | move |
| **Textblock** | | |
| `static/css/modules/textblock/textblock-content.css` | `static/css/constructor/textblock/textblock-content.css` | move |
| `static/css/modules/textblock/textblock-toolbar.css` | `static/css/constructor/textblock/textblock-toolbar.css` | move |
| `static/css/modules/textblock/textblock-links-footnotes.css` | `static/css/constructor/textblock/textblock-links-footnotes.css` | move |
| **Violation** | | |
| `static/css/modules/violation/violation-base.css` | `static/css/constructor/violation/violation-base.css` | move |
| `static/css/modules/violation/violation-fields.css` | `static/css/constructor/violation/violation-fields.css` | move |
| `static/css/modules/violation/violation-list.css` | `static/css/constructor/violation/violation-list.css` | move |
| `static/css/modules/violation/violation-additional-content.css` | `static/css/constructor/violation/violation-additional-content.css` | move |
| **Preview** | | |
| `static/css/modules/preview/preview-base.css` | `static/css/constructor/preview/preview-base.css` | move |
| `static/css/modules/preview/preview-typography.css` | `static/css/constructor/preview/preview-typography.css` | move |
| `static/css/modules/preview/preview-table.css` | `static/css/constructor/preview/preview-table.css` | move |
| `static/css/modules/preview/preview-violation.css` | `static/css/constructor/preview/preview-violation.css` | move |
| `static/css/modules/preview/preview-menu.css` | `static/css/constructor/preview/preview-menu.css` | move |
| **Context Menu** | | |
| `static/css/modules/context-menu/context-menu-base.css` | `static/css/constructor/context-menu/context-menu-base.css` | move |
| `static/css/modules/context-menu/context-menu-states.css` | `static/css/constructor/context-menu/context-menu-states.css` | move |
| **Items** | | |
| `static/css/modules/items/items-base.css` | `static/css/constructor/items/items-base.css` | move |
| `static/css/modules/items/items-levels.css` | `static/css/constructor/items/items-levels.css` | move |
| `static/css/modules/items/items-header.css` | `static/css/constructor/items/items-header.css` | move |
| `static/css/modules/items/items-content.css` | `static/css/constructor/items/items-content.css` | move |
| **Dialog (constructor-specific)** | | |
| `static/css/modules/dialog/dialog-invoice.css` | `static/css/constructor/dialog/dialog-invoice.css` | move |
| **Help** | | |
| `static/css/modules/help/help-button.css` | `static/css/constructor/help/help-button.css` | move |
| `static/css/modules/help/help-modal.css` | `static/css/constructor/help/help-modal.css` | move |
| `static/css/modules/help/help-content.css` | `static/css/constructor/help/help-content.css` | move |
| **Buttons (constructor-specific)** | | |
| `static/css/modules/buttons/buttons-save-group.css` | `static/css/constructor/buttons/buttons-save-group.css` | move |
| **Utilities** | | |
| `static/css/utilities/helpers.css` | `static/css/constructor/utilities/helpers.css` | move |
| `static/css/utilities/save-indicator.css` | `static/css/constructor/utilities/save-indicator.css` | move |

### 2.5 Entry Points (new aggregate files)

| Old Path | New Path | Action |
|----------|----------|--------|
| _(none)_ | `static/css/entry/shared.css` | new |
| _(none)_ | `static/css/entry/portal.css` | new |
| _(none)_ | `static/css/entry/constructor.css` | new |

### 2.6 Files to Delete After Migration

| Old Path | Action | Note |
|----------|--------|------|
| `static/css/main.css` | delete | Replaced by `entry/shared.css`, `entry/portal.css`, `entry/constructor.css`. Temporarily rewritten as bridge during Phase 2, deleted in Phase 5 cleanup. |

### 2.7 CSS Summary

| Category | File Count |
|----------|-----------|
| Base (unchanged) | 4 |
| Base (moved to constructor) | 1 |
| Shared (moved) | 8 |
| Shared (new) | 1 |
| Portal (moved) | 7 |
| Portal (new) | 1 |
| Constructor (moved) | 39 |
| Entry points (new) | 3 |
| Deleted (`main.css`) | 1 |
| **Total CSS files on disk** | **60** |
| **Total CSS files after refactoring** | **64** (60 - 1 deleted + 5 new) |

---

## 3. Template Files (`templates/`)

### 3.1 Shared Templates

| Old Path | New Path | Action |
|----------|----------|--------|
| `templates/components/auth_error.html` | `templates/shared/auth_error.html` | move |
| `templates/components/chat_content.html` | `templates/shared/chat_content.html` | move |
| `templates/components/dialog.html` | `templates/shared/dialog.html` | move |

### 3.2 Portal Templates

| Old Path | New Path | Action |
|----------|----------|--------|
| **Base** | | |
| _(none)_ | `templates/portal/base_portal.html` | new |
| **Layout** | | |
| `templates/components/landing_sidebar.html` | `templates/portal/layout/sidebar.html` | move |
| `templates/components/landing_topbar.html` | `templates/portal/layout/topbar.html` | move |
| `templates/components/settings_menu.html` | `templates/portal/layout/settings_menu.html` | move |
| **Landing** | | |
| `templates/landing.html` | `templates/portal/landing/landing.html` | move |
| **Acts Manager** | | |
| `templates/acts_manager.html` | `templates/portal/acts-manager/acts_manager.html` | move |
| `templates/components/acts/acts_card.html` | `templates/portal/acts-manager/components/acts_card.html` | move |
| `templates/components/acts/acts_empty_state.html` | `templates/portal/acts-manager/components/acts_empty_state.html` | move |
| `templates/components/acts/acts_error_state.html` | `templates/portal/acts-manager/components/acts_error_state.html` | move |
| `templates/components/acts/acts_loading.html` | `templates/portal/acts-manager/components/acts_loading.html` | move |
| `templates/components/acts/create_act_dialog.html` | `templates/portal/acts-manager/components/create_act_dialog.html` | move |
| `templates/components/acts/directive_row.html` | `templates/portal/acts-manager/components/directive_row.html` | move |
| `templates/components/acts/team_member_row.html` | `templates/portal/acts-manager/components/team_member_row.html` | move |
| **CK Stubs** | | |
| `templates/ck_fin_res.html` | `templates/portal/ck/ck_fin_res.html` | move |
| `templates/ck_client_experience.html` | `templates/portal/ck/ck_client_experience.html` | move |

### 3.3 Constructor Templates

| Old Path | New Path | Action |
|----------|----------|--------|
| **Base** | | |
| _(none)_ | `templates/constructor/base_constructor.html` | new |
| **Main page** | | |
| `templates/constructor.html` | `templates/constructor/constructor.html` | move |
| **Header** | | |
| `templates/header/header.html` | `templates/constructor/header/header.html` | move |
| `templates/header/header_steps.html` | `templates/constructor/header/header_steps.html` | move |
| `templates/header/header_save_indicator.html` | `templates/constructor/header/header_save_indicator.html` | move |
| `templates/header/header_exit_button.html` | `templates/constructor/header/header_exit_button.html` | move |
| `templates/header/header_acts_menu.html` | `templates/constructor/header/header_acts_menu.html` | move |
| `templates/header/header_help_button.html` | `templates/constructor/header/header_help_button.html` | move |
| `templates/header/header_preview_button.html` | `templates/constructor/header/header_preview_button.html` | move |
| `templates/header/header_settings_menu.html` | `templates/constructor/header/header_settings_menu.html` | move |
| `templates/header/acts_menu_item.html` | `templates/constructor/header/acts_menu_item.html` | move |
| `templates/header/help_modal.html` | `templates/constructor/header/help_modal.html` | move |
| **Help** | | |
| `templates/header/help/step1.html` | `templates/constructor/help/step1.html` | move |
| `templates/header/help/step2.html` | `templates/constructor/help/step2.html` | move |
| **Components** | | |
| `templates/components/tree_panel.html` | `templates/constructor/components/tree_panel.html` | move |
| `templates/components/preview_panel.html` | `templates/constructor/components/preview_panel.html` | move |
| `templates/components/context_menu.html` | `templates/constructor/components/context_menu.html` | move |
| `templates/components/invoice_dialog.html` | `templates/constructor/components/invoice_dialog.html` | move |

### 3.4 Templates to Delete After Migration

| Old Path | Action | Note |
|----------|--------|------|
| `templates/base.html` | delete | Replaced by `portal/base_portal.html` and `constructor/base_constructor.html` |

> **Note:** All other old template files (listed with `move` action above) are deleted as part of Phase 5 cleanup after migration is verified. The `templates/components/` and `templates/header/` directories are fully emptied and removed.

### 3.5 Template Summary

| Category | File Count |
|----------|-----------|
| Shared (moved) | 3 |
| Portal (moved) | 14 |
| Portal (new) | 1 |
| Constructor (moved) | 17 |
| Constructor (new) | 1 |
| Deleted (`base.html`) | 1 |
| **Total templates on disk** | **35** |
| **Total templates after refactoring** | **36** (35 - 1 deleted + 2 new) |

---

## 4. Backend Files (`app/`)

### 4.1 Files That Change

| Old Path | New Path | Action |
|----------|----------|--------|
| `app/main.py` | `app/main.py` | modify |
| _(none)_ | `app/core/middleware.py` | new |
| _(none)_ | `app/routes/__init__.py` | new |
| _(none)_ | `app/routes/portal.py` | new |
| _(none)_ | `app/routes/constructor.py` | new |

**`app/main.py` modifications:**
- Extract 3 middleware classes (`HTTPSRedirectMiddleware`, `RateLimitMiddleware`, `RequestSizeLimitMiddleware`) into `app/core/middleware.py`
- Extract 5 HTML route handlers (`show_landing`, `show_acts_manager`, `show_ck_fin_res`, `show_ck_client_experience`, `show_constructor`) into `app/routes/portal.py` and `app/routes/constructor.py`
- Import middleware from `app.core.middleware`
- Import routers from `app.routes.portal` and `app.routes.constructor`
- Remaining in `main.py`: `create_app()`, `lifespan`, favicon handler, `kerberos_token_expired_handler`, static mount, middleware setup

### 4.2 Files That Stay Unchanged

| Path | Action |
|------|--------|
| `app/__init__.py` | unchanged |
| `app/core/__init__.py` | unchanged |
| `app/core/config.py` | unchanged |
| `app/api/__init__.py` | unchanged |
| `app/api/v1/__init__.py` | unchanged |
| `app/api/v1/routes.py` | unchanged |
| `app/api/v1/deps/__init__.py` | unchanged |
| `app/api/v1/deps/auth_deps.py` | unchanged |
| `app/api/v1/endpoints/__init__.py` | unchanged |
| `app/api/v1/endpoints/acts.py` | unchanged |
| `app/api/v1/endpoints/acts_content.py` | unchanged |
| `app/api/v1/endpoints/acts_export.py` | unchanged |
| `app/api/v1/endpoints/acts_invoice.py` | unchanged |
| `app/api/v1/endpoints/auth.py` | unchanged |
| `app/api/v1/endpoints/system.py` | unchanged |
| `app/db/__init__.py` | unchanged |
| `app/db/connection.py` | unchanged |
| `app/db/adapters/__init__.py` | unchanged |
| `app/db/adapters/base.py` | unchanged |
| `app/db/adapters/greenplum.py` | unchanged |
| `app/db/adapters/postgresql.py` | unchanged |
| `app/db/queries/__init__.py` | unchanged |
| `app/db/queries/act_filters.py` | unchanged |
| `app/db/queries/act_queries.py` | unchanged |
| `app/db/repositories/__init__.py` | unchanged |
| `app/db/repositories/act_repository.py` | unchanged |
| `app/db/utils/__init__.py` | unchanged |
| `app/db/utils/act_directives_validator.py` | unchanged |
| `app/db/utils/json_db_utils.py` | unchanged |
| `app/db/utils/km_utils.py` | unchanged |
| `app/formatters/__init__.py` | unchanged |
| `app/formatters/ai_readable_formatter.py` | unchanged |
| `app/formatters/base_formatter.py` | unchanged |
| `app/formatters/docx_formatter.py` | unchanged |
| `app/formatters/markdown_formatter.py` | unchanged |
| `app/formatters/text_formatter.py` | unchanged |
| `app/formatters/utils/__init__.py` | unchanged |
| `app/formatters/utils/formatting_utils.py` | unchanged |
| `app/formatters/utils/html_utils.py` | unchanged |
| `app/formatters/utils/json_utils.py` | unchanged |
| `app/formatters/utils/table_utils.py` | unchanged |
| `app/integrations/__init__.py` | unchanged |
| `app/integrations/ai_assistant_bd_oarb/__init__.py` | unchanged |
| `app/integrations/ai_assistant_bd_oarb/data_export.py` | unchanged |
| `app/schemas/__init__.py` | unchanged |
| `app/schemas/act_content.py` | unchanged |
| `app/schemas/act_invoice.py` | unchanged |
| `app/schemas/act_metadata.py` | unchanged |
| `app/services/__init__.py` | unchanged |
| `app/services/audit_id_service.py` | unchanged |
| `app/services/export_service.py` | unchanged |
| `app/services/storage_service.py` | unchanged |
| `app/start_search.py` | unchanged |

---

## 5. Completeness Verification

### 5.1 JS File Count Check

| Source | Count |
|--------|-------|
| Files on disk (`static/js/**/*.js`) | 63 |
| Files in mapping (move actions) | 63 |
| **Match** | YES |

### 5.2 CSS File Count Check

| Source | Count |
|--------|-------|
| Files on disk (`static/css/**/*.css`) | 60 |
| Files in mapping (move + unchanged + delete) | 60 |
| New files to create | 5 |
| **Match** | YES |

### 5.3 Template File Count Check

| Source | Count |
|--------|-------|
| Files on disk (`templates/**/*.html`) | 35 |
| Files in mapping (move + delete) | 35 |
| New files to create | 2 |
| **Match** | YES |

### 5.4 Backend File Count Check

| Source | Count |
|--------|-------|
| Files on disk (`app/**/*.py`) | 54 |
| Files in mapping (unchanged + modify) | 54 |
| New files to create | 4 |
| **Match** | YES |

---

## 6. Directory Structure After Refactoring

### 6.1 `static/js/` (final)

```
static/js/
├── shared/
│   ├── app-config.js
│   ├── auth.js
│   ├── api.js
│   ├── notifications.js
│   ├── chat/
│   │   ├── chat-manager.js
│   │   └── chat-modal.js
│   └── dialog/
│       ├── dialog-base.js
│       └── dialog-confirm.js
├── portal/
│   ├── portal-sidebar.js
│   ├── portal-settings.js
│   ├── landing/
│   │   └── landing-page.js
│   └── acts-manager/
│       ├── acts-manager-page.js
│       └── dialog-create-act.js
└── constructor/
    ├── app.js
    ├── lock-manager.js
    ├── storage-manager.js
    ├── navigation-manager.js
    ├── header/
    │   ├── header-exit.js
    │   ├── acts-menu.js
    │   ├── format-menu-manager.js
    │   ├── preview-menu.js
    │   └── settings-menu.js
    ├── state/
    │   ├── state-core.js
    │   ├── state-tree.js
    │   └── state-content.js
    ├── tree/
    │   ├── tree-core.js
    │   ├── tree-renderer.js
    │   ├── tree-drag-drop.js
    │   └── tree-utils.js
    ├── items/
    │   ├── items-renderer.js
    │   └── items-title-editing.js
    ├── table/
    │   ├── table-core.js
    │   ├── table-cells-operations.js
    │   └── table-sizes.js
    ├── textblock/
    │   ├── textblock-core.js
    │   ├── textblock-editor.js
    │   ├── textblock-formatting.js
    │   ├── textblock-toolbar.js
    │   └── textblock-links-footnotes.js
    ├── violation/
    │   ├── violation-core.js
    │   ├── violation-rendering.js
    │   ├── violation-init.js
    │   ├── violation-paste.js
    │   ├── violation-drag-drop.js
    │   ├── violation-additional-content.js
    │   └── violation-file-upload.js
    ├── preview/
    │   ├── preview.js
    │   ├── preview-table-renderer.js
    │   ├── preview-textblock-renderer.js
    │   └── preview-violation-renderer.js
    ├── context-menu/
    │   ├── context-menu-core.js
    │   ├── context-menu-tree.js
    │   ├── context-menu-cells.js
    │   ├── context-menu-violation.js
    │   └── context-menu-links-footnotes.js
    ├── dialog/
    │   ├── dialog-help.js
    │   └── dialog-invoice.js
    ├── validation/
    │   ├── validation.js
    │   ├── validation-core.js
    │   ├── validation-act.js
    │   ├── validation-table.js
    │   └── validation-tree.js
    └── services/
        └── id-generator.js
```

### 6.2 `static/css/` (final)

```
static/css/
├── base/
│   ├── variables.css
│   ├── reset.css
│   ├── animations.css
│   └── auth.css
├── shared/
│   ├── buttons/
│   │   ├── buttons-base.css
│   │   └── buttons-action.css
│   ├── notifications/
│   │   ├── notifications-base.css
│   │   ├── notifications-types.css
│   │   └── notifications-content.css
│   ├── dialog/
│   │   ├── dialog.css
│   │   ├── dialog-overlay.css
│   │   └── dialog-buttons.css
│   └── chat/
│       └── chat.css
├── portal/
│   ├── layout/
│   │   ├── sidebar.css
│   │   ├── topbar.css
│   │   └── settings-menu.css
│   ├── landing/
│   │   └── landing.css
│   └── acts-manager/
│       ├── acts-manager-base.css
│       ├── acts-manager-cards.css
│       ├── acts-menu.css
│       └── acts-modal.css
├── constructor/
│   ├── layout/
│   │   ├── container.css
│   │   ├── header.css
│   │   ├── header-actions.css
│   │   ├── two-columns.css
│   │   └── panels.css
│   ├── tree/
│   │   ├── tree-base.css
│   │   ├── tree-nodes.css
│   │   ├── tree-children.css
│   │   ├── tree-drag-drop.css
│   │   └── tree-states.css
│   ├── table/
│   │   ├── table-base.css
│   │   ├── table-states.css
│   │   ├── table-resize.css
│   │   └── table-editor.css
│   ├── textblock/
│   │   ├── textblock-content.css
│   │   ├── textblock-toolbar.css
│   │   └── textblock-links-footnotes.css
│   ├── violation/
│   │   ├── violation-base.css
│   │   ├── violation-fields.css
│   │   ├── violation-list.css
│   │   └── violation-additional-content.css
│   ├── preview/
│   │   ├── preview-base.css
│   │   ├── preview-typography.css
│   │   ├── preview-table.css
│   │   ├── preview-violation.css
│   │   └── preview-menu.css
│   ├── context-menu/
│   │   ├── context-menu-base.css
│   │   └── context-menu-states.css
│   ├── items/
│   │   ├── items-base.css
│   │   ├── items-levels.css
│   │   ├── items-header.css
│   │   └── items-content.css
│   ├── dialog/
│   │   └── dialog-invoice.css
│   ├── help/
│   │   ├── help-button.css
│   │   ├── help-modal.css
│   │   └── help-content.css
│   ├── buttons/
│   │   └── buttons-save-group.css
│   └── utilities/
│       ├── helpers.css
│       ├── save-indicator.css
│       └── read-only.css
└── entry/
    ├── shared.css
    ├── portal.css
    └── constructor.css
```

### 6.3 `templates/` (final)

```
templates/
├── shared/
│   ├── auth_error.html
│   ├── chat_content.html
│   └── dialog.html
├── portal/
│   ├── base_portal.html
│   ├── layout/
│   │   ├── sidebar.html
│   │   ├── topbar.html
│   │   └── settings_menu.html
│   ├── landing/
│   │   └── landing.html
│   ├── acts-manager/
│   │   ├── acts_manager.html
│   │   └── components/
│   │       ├── acts_card.html
│   │       ├── acts_empty_state.html
│   │       ├── acts_error_state.html
│   │       ├── acts_loading.html
│   │       ├── create_act_dialog.html
│   │       ├── directive_row.html
│   │       └── team_member_row.html
│   └── ck/
│       ├── ck_fin_res.html
│       └── ck_client_experience.html
└── constructor/
    ├── base_constructor.html
    ├── constructor.html
    ├── header/
    │   ├── header.html
    │   ├── header_steps.html
    │   ├── header_save_indicator.html
    │   ├── header_exit_button.html
    │   ├── header_acts_menu.html
    │   ├── header_help_button.html
    │   ├── header_preview_button.html
    │   ├── header_settings_menu.html
    │   ├── acts_menu_item.html
    │   └── help_modal.html
    ├── help/
    │   ├── step1.html
    │   └── step2.html
    └── components/
        ├── tree_panel.html
        ├── preview_panel.html
        ├── context_menu.html
        └── invoice_dialog.html
```

### 6.4 `app/` (changes only)

```
app/
├── main.py                    # modified (simplified)
├── core/
│   ├── config.py              # unchanged
│   └── middleware.py           # new
└── routes/
    ├── __init__.py             # new
    ├── portal.py               # new
    └── constructor.py          # new
```

---

## 7. Cross-Reference: Template Include Paths to Update

When templates are moved, all `{% include %}` and `{% extends %}` directives must be updated.
This section lists which template references change.

### 7.1 Portal Templates

| Template | Old Include | New Include |
|----------|------------|-------------|
| `landing.html` | `{% include 'components/landing_sidebar.html' %}` | `{% include 'portal/layout/sidebar.html' %}` |
| `landing.html` | `{% include 'components/landing_topbar.html' %}` | `{% include 'portal/layout/topbar.html' %}` |
| `landing.html` | `{% include 'components/settings_menu.html' %}` | `{% include 'portal/layout/settings_menu.html' %}` |
| `landing.html` | `{% include 'components/chat_content.html' %}` | `{% include 'shared/chat_content.html' %}` |
| `landing.html` | `{% include 'components/auth_error.html' %}` | `{% include 'shared/auth_error.html' %}` |
| `landing.html` | `{% include 'components/dialog.html' %}` | `{% include 'shared/dialog.html' %}` |
| `acts_manager.html` | `{% include 'components/landing_sidebar.html' %}` | `{% include 'portal/layout/sidebar.html' %}` |
| `acts_manager.html` | `{% include 'components/landing_topbar.html' %}` | `{% include 'portal/layout/topbar.html' %}` |
| `acts_manager.html` | `{% include 'components/settings_menu.html' %}` | `{% include 'portal/layout/settings_menu.html' %}` |
| `acts_manager.html` | `{% include 'components/chat_content.html' %}` | `{% include 'shared/chat_content.html' %}` |
| `acts_manager.html` | `{% include 'components/auth_error.html' %}` | `{% include 'shared/auth_error.html' %}` |
| `acts_manager.html` | `{% include 'components/dialog.html' %}` | `{% include 'shared/dialog.html' %}` |
| `acts_manager.html` | `{% include 'components/acts/acts_card.html' %}` | `{% include 'portal/acts-manager/components/acts_card.html' %}` |
| `acts_manager.html` | (similar for other acts/ components) | (use `portal/acts-manager/components/` prefix) |

### 7.2 Constructor Templates

| Template | Old Include | New Include |
|----------|------------|-------------|
| `constructor.html` | `{% extends 'base.html' %}` | `{% extends 'constructor/base_constructor.html' %}` |
| `constructor.html` | `{% include 'components/tree_panel.html' %}` | `{% include 'constructor/components/tree_panel.html' %}` |
| `constructor.html` | `{% include 'components/preview_panel.html' %}` | `{% include 'constructor/components/preview_panel.html' %}` |
| `constructor.html` | `{% include 'components/context_menu.html' %}` | `{% include 'constructor/components/context_menu.html' %}` |
| `base.html` (now `base_constructor.html`) | `{% include 'header/header.html' %}` | `{% include 'constructor/header/header.html' %}` |
| `base.html` (now `base_constructor.html`) | `{% include 'components/auth_error.html' %}` | `{% include 'shared/auth_error.html' %}` |
| `base.html` (now `base_constructor.html`) | `{% include 'components/dialog.html' %}` | `{% include 'shared/dialog.html' %}` |
| `base.html` (now `base_constructor.html`) | `{% include 'components/invoice_dialog.html' %}` | `{% include 'constructor/components/invoice_dialog.html' %}` |
| `header.html` | `{% include 'header/header_steps.html' %}` | `{% include 'constructor/header/header_steps.html' %}` |
| `header.html` | (similar for other header sub-templates) | (use `constructor/header/` prefix) |
| `header.html` | `{% include 'header/help_modal.html' %}` | `{% include 'constructor/header/help_modal.html' %}` |
| `help_modal.html` | `{% include 'header/help/step1.html' %}` | `{% include 'constructor/help/step1.html' %}` |
| `help_modal.html` | `{% include 'header/help/step2.html' %}` | `{% include 'constructor/help/step2.html' %}` |

### 7.3 Backend Route Template Paths

| Route File | Old Template Path | New Template Path |
|-----------|------------------|------------------|
| `app/routes/portal.py` | `landing.html` | `portal/landing/landing.html` |
| `app/routes/portal.py` | `acts_manager.html` | `portal/acts-manager/acts_manager.html` |
| `app/routes/portal.py` | `ck_fin_res.html` | `portal/ck/ck_fin_res.html` |
| `app/routes/portal.py` | `ck_client_experience.html` | `portal/ck/ck_client_experience.html` |
| `app/routes/constructor.py` | `constructor.html` | `constructor/constructor.html` |

---

## 8. Transition Strategy Notes

1. **Phase 2 (CSS):** Old `main.css` is rewritten as a bridge importing from new locations. Templates still reference `main.css`, so everything works during transition.

2. **Phase 3 (JS):** Files are COPIED (not moved) to new locations. Old files remain, old `<script>` tags in templates still work. Originals deleted only in Phase 5 after templates are updated.

3. **Phase 4 (Portal templates):** Portal pages switch to new `base_portal.html` with new JS/CSS paths. Old template files kept until Phase 5 cleanup.

4. **Phase 5 (Constructor templates):** Constructor switches to new `base_constructor.html`. After verification, all old files are deleted.

5. **Rollback:** Each phase is committed separately with a git tag. Any phase can be reverted independently.
