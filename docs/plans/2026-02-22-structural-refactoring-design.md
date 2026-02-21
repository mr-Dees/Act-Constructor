# Structural Refactoring Design

**Date:** 2026-02-22
**Branch:** refactor/service-architecture
**Status:** Approved

## Goal

Restructure the Act Constructor project to clearly separate concerns between
portal pages (landing, acts manager, CK stubs) and the constructor editor,
with a shared layer for cross-cutting components. No logic changes.

## Principles

1. **3 zones**: shared, portal, constructor
2. **JS logic in shared**, CSS styling per zone (with class extension if behavior diverges)
3. **Two base templates**: `base_portal.html` (sidebar layout), `base_constructor.html` (editor layout)
4. **Backend minimal changes**: extract middleware, split HTML routes, keep all business logic as-is
5. **Proxy compatibility**: preserve `root_path`, `url_for()`, `AppConfig.api.getUrl()` behavior

---

## Frontend Structure

### static/js/

```
static/js/
├── shared/                          # Cross-cutting (all pages)
│   ├── app-config.js                # URL logic, constants
│   ├── auth.js                      # AuthManager
│   ├── api.js                       # APIClient
│   ├── notifications.js             # NotificationManager
│   ├── chat/
│   │   ├── chat-manager.js          # ChatManager (logic)
│   │   └── chat-modal.js            # ChatModalManager (modal overlay)
│   └── dialog/
│       ├── dialog-base.js           # DialogBase
│       └── dialog-confirm.js        # DialogManager (confirm/alert)
│
├── portal/                          # Portal pages (sidebar layout)
│   ├── portal-sidebar.js            # LandingSidebar (renamed)
│   ├── portal-settings.js           # LandingSettingsManager (renamed)
│   ├── landing/
│   │   └── landing-page.js          # LandingPage
│   ├── acts-manager/
│   │   ├── acts-manager-page.js     # ActsManagerPage
│   │   └── dialog-create-act.js     # CreateActDialog
│   └── ck/                          # Future CK modules placeholder
│
└── constructor/                     # Act editor (own layout)
    ├── app.js                       # App orchestrator
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

### static/css/

```
static/css/
├── base/                            # Foundation (all pages)
│   ├── variables.css
│   ├── reset.css
│   ├── animations.css
│   └── auth.css
│
├── shared/                          # Cross-cutting component styles
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
│
├── portal/                          # Portal layout styles
│   ├── layout/
│   │   ├── sidebar.css
│   │   ├── topbar.css
│   │   └── settings-menu.css
│   ├── landing/
│   │   └── landing.css
│   ├── acts-manager/
│   │   ├── acts-manager-base.css
│   │   ├── acts-manager-cards.css
│   │   ├── acts-menu.css
│   │   └── acts-modal.css
│   └── ck/
│
├── constructor/                     # Constructor styles
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
│
└── entry/                           # Entry points (replace single main.css)
    ├── shared.css                   # @import base/* + shared/*
    ├── portal.css                   # @import shared.css + portal/*
    └── constructor.css              # @import shared.css + constructor/*
```

### templates/

```
templates/
├── shared/                          # Cross-cutting components
│   ├── auth_error.html
│   ├── chat_content.html
│   └── dialog.html
│
├── portal/                          # Portal layout
│   ├── base_portal.html             # Base: sidebar + topbar + settings + shared JS
│   ├── layout/
│   │   ├── sidebar.html
│   │   ├── topbar.html
│   │   └── settings_menu.html
│   ├── landing/
│   │   └── landing.html             # extends base_portal.html
│   ├── acts-manager/
│   │   ├── acts_manager.html        # extends base_portal.html
│   │   └── components/
│   │       ├── acts_card.html
│   │       ├── acts_empty_state.html
│   │       ├── acts_error_state.html
│   │       ├── acts_loading.html
│   │       ├── create_act_dialog.html
│   │       ├── directive_row.html
│   │       └── team_member_row.html
│   └── ck/
│       ├── ck_fin_res.html          # extends base_portal.html
│       └── ck_client_experience.html
│
└── constructor/                     # Act editor
    ├── base_constructor.html        # Base: constructor header + all constructor JS
    ├── constructor.html             # extends base_constructor.html
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

---

## Backend Structure

Minimal changes to `app/`:

```
app/
├── main.py                          # SIMPLIFIED: create_app() + lifespan only (~100 lines)
│
├── core/
│   ├── config.py                    # unchanged
│   └── middleware.py                # NEW: HTTPSRedirect, RateLimit, RequestSizeLimit
│
├── routes/                          # NEW: HTML page routes
│   ├── __init__.py
│   ├── portal.py                    # GET /, /acts, /ck-fin-res, /ck-client-experience
│   └── constructor.py               # GET /constructor (with access check)
│
├── api/                             # unchanged
├── db/                              # unchanged
├── formatters/                      # unchanged
├── schemas/                         # unchanged
├── services/                        # unchanged
└── integrations/                    # unchanged
```

---

## Critical Constraints

1. **Proxy compatibility**: `root_path`, `url_for('static', path=...)`, `AppConfig.api.getUrl()`
   must continue to work both with direct access and behind JupyterHub proxy.
2. **No logic changes**: This is a structural refactoring only. All behavior stays identical.
3. **Git versioning**: Each logical phase committed separately for traceability.

## Agent Allocation

- **Architect agent**: Designs file mapping (old path -> new path), validates no files are lost
- **Backend agent**: Refactors `main.py`, creates `middleware.py` and `routes/`
- **Frontend agent**: Moves JS/CSS/templates, updates all paths and imports
- **Team lead**: Testing, verification, git commits after each phase
