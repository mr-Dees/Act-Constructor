# Structural Refactoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize the Act Constructor project into 3 clear zones (shared/portal/constructor) without changing any business logic.

**Architecture:** Move files into zone-based directory structure. Two base templates replace one. Three CSS entry points replace single main.css. Backend gets middleware extraction and route separation.

**Tech Stack:** Python/FastAPI, vanilla JS (ES6+), Jinja2, CSS @import

---

## Execution Order & Dependencies

The refactoring is split into 5 phases. The application MUST work correctly after each phase is completed and committed. Phases must be executed in order.

```
Phase 1: Backend ─────────────► commit & test
Phase 2: CSS restructure ────► commit & test
Phase 3: JS restructure ─────► commit & test
Phase 4: Portal templates ───► commit & test
Phase 5: Constructor templates► commit & test
```

## Agent Allocation

- **Architect agent** (Task 1): Creates file mapping, validates completeness
- **Backend agent** (Task 2-4): Refactors main.py, middleware, routes
- **Frontend agent** (Tasks 5-15): Moves CSS/JS/templates, updates paths
- **Team lead**: Runs verification after each phase, commits

## Verification Protocol

After each phase, verify:
1. `python -m py_compile app/main.py` — Python syntax OK
2. Start server: `cd "D:/PROJECT/Pyton/Act Constructor" && python -m app.main`
3. Check pages manually:
   - `GET /` — landing loads, sidebar visible, chat works
   - `GET /acts` — acts manager loads, cards visible, create dialog works
   - `GET /ck-fin-res` — stub page loads
   - `GET /constructor?act_id=X` — constructor loads (needs valid act_id)
4. Check browser console — no 404 for JS/CSS files
5. Check that JupyterHub proxy paths still resolve (if environment available)

---

## Phase 1: Backend Refactoring

### Task 1: Create file mapping document

**Agent:** Architect
**Purpose:** Build exact old→new path mapping for every file in the project. This is the reference document for all subsequent tasks.

**Files:**
- Create: `docs/plans/file-mapping.md`

**Step 1:** Generate complete mapping of every file move

The mapping must list:
- Every JS file: old path → new path
- Every CSS file: old path → new path
- Every template: old path → new path
- Every backend file: old path → new path (or "unchanged")

**Step 2:** Validate completeness

Cross-check against the current directory listing to ensure no files are missed.

**Step 3:** Commit

```bash
git add -f docs/plans/file-mapping.md
git commit -m "Добавлена карта перемещения файлов для рефакторинга"
```

---

### Task 2: Extract middleware from main.py

**Agent:** Backend
**Purpose:** Move 3 middleware classes from `main.py` into `app/core/middleware.py`

**Files:**
- Create: `app/core/middleware.py`
- Modify: `app/main.py`

**Step 1:** Create `app/core/middleware.py`

Copy these classes from `main.py` into the new file:
- `HTTPSRedirectMiddleware` (lines 43-76)
- `RateLimitMiddleware` (lines 79-155)
- `RequestSizeLimitMiddleware` (lines 158-206)

Include all necessary imports:
```python
import threading
from datetime import datetime, timedelta
from cachetools import TTLCache
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import Settings, setup_logging

settings = Settings()
logger = setup_logging(settings.log_level)
```

**Step 2:** Update `main.py` imports

Replace the 3 class definitions with:
```python
from app.core.middleware import (
    HTTPSRedirectMiddleware,
    RateLimitMiddleware,
    RequestSizeLimitMiddleware
)
```

Remove unused imports from main.py: `threading`, `datetime`, `timedelta`, `cachetools.TTLCache`, `BaseHTTPMiddleware`.

**Step 3:** Verify Python compiles

```bash
python -m py_compile app/core/middleware.py
python -m py_compile app/main.py
```

**Step 4:** Commit

```bash
git add app/core/middleware.py app/main.py
git commit -m "Вынесен middleware из main.py в app/core/middleware.py"
```

---

### Task 3: Extract HTML routes from main.py

**Agent:** Backend
**Purpose:** Move page-serving routes into `app/routes/portal.py` and `app/routes/constructor.py`

**Files:**
- Create: `app/routes/__init__.py`
- Create: `app/routes/portal.py`
- Create: `app/routes/constructor.py`
- Modify: `app/main.py`

**Step 1:** Create `app/routes/__init__.py`

```python
"""HTML page routes."""
```

**Step 2:** Create `app/routes/portal.py`

Move these route handlers from `main.py`:
- `show_landing` (GET /)
- `show_acts_manager` (GET /acts)
- `show_ck_fin_res` (GET /ck-fin-res)
- `show_ck_client_experience` (GET /ck-client-experience)

Use `APIRouter` pattern:
```python
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from app.core.config import Settings

settings = Settings()
templates = Jinja2Templates(directory=str(settings.templates_dir))
router = APIRouter()

@router.get("/", response_class=HTMLResponse)
async def show_landing(request: Request):
    # ... same logic as current main.py
```

**Step 3:** Create `app/routes/constructor.py`

Move `show_constructor` handler (GET /constructor). This one has dependencies:
```python
from fastapi import APIRouter, Request, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from app.core.config import Settings, setup_logging
from app.api.v1.deps.auth_deps import get_username
from app.db.connection import get_db
from app.db.repositories.act_repository import ActDBService

settings = Settings()
logger = setup_logging(settings.log_level)
templates = Jinja2Templates(directory=str(settings.templates_dir))
router = APIRouter()

@router.get("/constructor", response_class=HTMLResponse)
async def show_constructor(request: Request, act_id: int, username: str = Depends(get_username)):
    # ... same logic as current main.py
```

**Step 4:** Update `main.py` to include route routers

Remove all route handler functions and add:
```python
from app.routes.portal import router as portal_router
from app.routes.constructor import router as constructor_router

# Inside create_app():
app.include_router(portal_router)
app.include_router(constructor_router)
```

Keep in `main.py`: `create_app()`, `lifespan`, favicon handler, `kerberos_token_expired_handler`, static mount, middleware setup.

**Step 5:** Verify

```bash
python -m py_compile app/routes/portal.py
python -m py_compile app/routes/constructor.py
python -m py_compile app/main.py
```

**Step 6:** Commit

```bash
git add app/routes/ app/main.py
git commit -m "Вынесены HTML-роуты из main.py в app/routes/"
```

---

### Task 4: Phase 1 verification

**Agent:** Team Lead
**Purpose:** Start server, verify all pages load correctly

**Step 1:** Start the server and test each route

```bash
cd "D:/PROJECT/Pyton/Act Constructor" && python -m app.main
```

Check in browser:
- `http://localhost:8000/` — landing page
- `http://localhost:8000/acts` — acts manager
- `http://localhost:8000/ck-fin-res` — CK stub
- `http://localhost:8000/ck-client-experience` — CK stub
- `http://localhost:8000/constructor?act_id=1` — constructor (may redirect if no act)

**Step 2:** Verify no import errors in server log

**Step 3:** Tag phase completion

```bash
git tag phase-1-backend-done
```

---

## Phase 2: CSS Restructure

### Task 5: Create CSS directory structure and move files

**Agent:** Frontend
**Purpose:** Move all CSS files into zone-based structure and create entry-point CSS files

**Files to create (directories):**
- `static/css/shared/buttons/`
- `static/css/shared/notifications/`
- `static/css/shared/dialog/`
- `static/css/shared/chat/`
- `static/css/portal/layout/`
- `static/css/portal/landing/`
- `static/css/portal/acts-manager/`
- `static/css/constructor/layout/`
- `static/css/constructor/tree/`
- `static/css/constructor/table/`
- `static/css/constructor/textblock/`
- `static/css/constructor/violation/`
- `static/css/constructor/preview/`
- `static/css/constructor/context-menu/`
- `static/css/constructor/items/`
- `static/css/constructor/dialog/`
- `static/css/constructor/help/`
- `static/css/constructor/buttons/`
- `static/css/constructor/utilities/`
- `static/css/entry/`

**Step 1:** Create all directories

**Step 2:** Move CSS files according to mapping:

Base (stays in place):
- `base/variables.css` → unchanged
- `base/reset.css` → unchanged
- `base/animations.css` → unchanged
- `base/auth.css` → unchanged

Shared:
- `modules/buttons/buttons-base.css` → `shared/buttons/buttons-base.css`
- `modules/buttons/buttons-action.css` → `shared/buttons/buttons-action.css`
- `modules/notifications/*` → `shared/notifications/*`
- `modules/dialog/dialog.css` → `shared/dialog/dialog.css`
- `modules/dialog/dialog-overlay.css` → `shared/dialog/dialog-overlay.css`
- `modules/dialog/dialog-buttons.css` → `shared/dialog/dialog-buttons.css`
- Extract chat styles from `modules/landing/landing.css` → `shared/chat/chat.css` (if separable, otherwise create minimal chat.css)

Portal:
- `modules/landing/landing-sidebar.css` → `portal/layout/sidebar.css`
- `layout/settings-menu.css` → `portal/layout/settings-menu.css`
- Extract topbar styles from `modules/landing/landing.css` → `portal/layout/topbar.css`
- `modules/landing/landing.css` → `portal/landing/landing.css` (remaining styles)
- `modules/acts-manager/*` → `portal/acts-manager/*`

Constructor:
- `layout/container.css` → `constructor/layout/container.css`
- `layout/header.css` → `constructor/layout/header.css`
- `layout/header-actions.css` → `constructor/layout/header-actions.css`
- `layout/two-columns.css` → `constructor/layout/two-columns.css`
- `layout/panels.css` → `constructor/layout/panels.css`
- `modules/tree/*` → `constructor/tree/*`
- `modules/table/*` → `constructor/table/*`
- `modules/textblock/*` → `constructor/textblock/*`
- `modules/violation/*` → `constructor/violation/*`
- `modules/preview/*` → `constructor/preview/*`
- `modules/context-menu/*` → `constructor/context-menu/*`
- `modules/items/*` → `constructor/items/*`
- `modules/dialog/dialog-invoice.css` → `constructor/dialog/dialog-invoice.css`
- `modules/help/*` → `constructor/help/*`
- `modules/buttons/buttons-save-group.css` → `constructor/buttons/buttons-save-group.css`
- `utilities/helpers.css` → `constructor/utilities/helpers.css`
- `utilities/save-indicator.css` → `constructor/utilities/save-indicator.css`
- `base/read-only.css` → `constructor/utilities/read-only.css`

**Step 3:** Create entry-point CSS files

Create `static/css/entry/shared.css`:
```css
/* Shared styles - base + cross-cutting components */

/* Base */
@import '../base/variables.css';
@import '../base/auth.css';
@import '../base/reset.css';
@import '../base/animations.css';

/* Shared components */
@import '../shared/buttons/buttons-base.css';
@import '../shared/buttons/buttons-action.css';
@import '../shared/notifications/notifications-base.css';
@import '../shared/notifications/notifications-types.css';
@import '../shared/notifications/notifications-content.css';
@import '../shared/dialog/dialog.css';
@import '../shared/dialog/dialog-overlay.css';
@import '../shared/dialog/dialog-buttons.css';
@import '../shared/chat/chat.css';
```

Create `static/css/entry/portal.css`:
```css
/* Portal pages - shared + portal layout + page-specific */
@import './shared.css';

/* Portal layout */
@import '../portal/layout/sidebar.css';
@import '../portal/layout/topbar.css';
@import '../portal/layout/settings-menu.css';

/* Landing */
@import '../portal/landing/landing.css';

/* Acts manager */
@import '../portal/acts-manager/acts-manager-base.css';
@import '../portal/acts-manager/acts-manager-cards.css';
@import '../portal/acts-manager/acts-menu.css';
@import '../portal/acts-manager/acts-modal.css';
```

Create `static/css/entry/constructor.css`:
```css
/* Constructor - shared + constructor-specific */
@import './shared.css';

/* Constructor layout */
@import '../constructor/layout/container.css';
@import '../constructor/layout/header.css';
@import '../constructor/layout/header-actions.css';
@import '../constructor/layout/two-columns.css';
@import '../constructor/layout/panels.css';

/* Tree */
@import '../constructor/tree/tree-base.css';
@import '../constructor/tree/tree-drag-drop.css';
@import '../constructor/tree/tree-states.css';
@import '../constructor/tree/tree-nodes.css';
@import '../constructor/tree/tree-children.css';

/* Table */
@import '../constructor/table/table-base.css';
@import '../constructor/table/table-states.css';
@import '../constructor/table/table-resize.css';
@import '../constructor/table/table-editor.css';

/* Violation */
@import '../constructor/violation/violation-base.css';
@import '../constructor/violation/violation-fields.css';
@import '../constructor/violation/violation-list.css';
@import '../constructor/violation/violation-additional-content.css';

/* Preview */
@import '../constructor/preview/preview-base.css';
@import '../constructor/preview/preview-typography.css';
@import '../constructor/preview/preview-table.css';
@import '../constructor/preview/preview-violation.css';
@import '../constructor/preview/preview-menu.css';

/* Help */
@import '../constructor/help/help-button.css';
@import '../constructor/help/help-modal.css';
@import '../constructor/help/help-content.css';

/* Buttons */
@import '../constructor/buttons/buttons-save-group.css';

/* Items */
@import '../constructor/items/items-base.css';
@import '../constructor/items/items-levels.css';
@import '../constructor/items/items-header.css';
@import '../constructor/items/items-content.css';

/* Textblock */
@import '../constructor/textblock/textblock-toolbar.css';
@import '../constructor/textblock/textblock-content.css';
@import '../constructor/textblock/textblock-links-footnotes.css';

/* Context menu */
@import '../constructor/context-menu/context-menu-base.css';
@import '../constructor/context-menu/context-menu-states.css';

/* Dialog (constructor-specific) */
@import '../constructor/dialog/dialog-invoice.css';

/* Utilities */
@import '../constructor/utilities/helpers.css';
@import '../constructor/utilities/save-indicator.css';
@import '../constructor/utilities/read-only.css';
```

**Step 4:** Update `main.css` to import from new locations (temporary compatibility bridge)

Rewrite `static/css/main.css` to import from new paths — this keeps all current templates working while we haven't updated them yet:
```css
/* Temporary bridge - imports all styles from new locations */
@import './entry/portal.css';
/* Also import constructor for base.html which loads main.css */
@import './constructor/layout/container.css';
/* ... all constructor imports ... */
```

This way the old `main.css` reference still works during transition.

**Step 5:** Delete empty old directories (only after confirming all files moved)

Remove emptied directories: `modules/`, `layout/` (only if all files moved out).
Keep `base/` in place.

**Step 6:** Commit

```bash
git add static/css/
git commit -m "Реструктуризация CSS: shared/portal/constructor + entry-point файлы"
```

---

### Task 6: Phase 2 verification

**Agent:** Team Lead

**Step 1:** Start server, check all pages render with correct styles
**Step 2:** Browser console — no 404 for CSS files
**Step 3:** Visual check — no layout breakage on any page

```bash
git tag phase-2-css-done
```

---

## Phase 3: JS Restructure

### Task 7: Create JS directory structure and move shared files

**Agent:** Frontend
**Purpose:** Move shared JS files (used by both portal and constructor)

**Files:**
- Create directories: `static/js/shared/`, `static/js/shared/chat/`, `static/js/shared/dialog/`
- Move files:
  - `app-config.js` → `shared/app-config.js`
  - `auth.js` → `shared/auth.js`
  - `api.js` → `shared/api.js`
  - `notifications.js` → `shared/notifications.js`
  - `chat-manager.js` → `shared/chat/chat-manager.js`
  - `chat-modal.js` → `shared/chat/chat-modal.js`
  - `dialog/dialog-base.js` → `shared/dialog/dialog-base.js`
  - `dialog/dialog-confirm.js` → `shared/dialog/dialog-confirm.js`

**IMPORTANT:** Do NOT delete original files yet — templates still reference old paths. Create copies in new locations. Originals will be removed in Phase 4/5 when templates are updated.

**Step 1:** Create directories and copy files

**Step 2:** Commit

```bash
git add static/js/shared/
git commit -m "Добавлены shared JS-файлы в новую структуру"
```

---

### Task 8: Move portal JS files

**Agent:** Frontend

**Files:**
- Create directories: `static/js/portal/`, `static/js/portal/landing/`, `static/js/portal/acts-manager/`, `static/js/portal/ck/`
- Move files:
  - `landing-sidebar.js` → `portal/portal-sidebar.js`
  - `landing-settings.js` → `portal/portal-settings.js`
  - `landing-page.js` → `portal/landing/landing-page.js`
  - `acts-manager-page.js` → `portal/acts-manager/acts-manager-page.js`
  - `dialog/dialog-create-act.js` → `portal/acts-manager/dialog-create-act.js`

**Step 1:** Create directories and copy files

**Step 2:** Commit

```bash
git add static/js/portal/
git commit -m "Добавлены portal JS-файлы в новую структуру"
```

---

### Task 9: Move constructor JS files

**Agent:** Frontend

**Files:**
- Create directory: `static/js/constructor/` with subdirectories:
  `header/`, `state/`, `tree/`, `items/`, `table/`, `textblock/`, `violation/`,
  `preview/`, `context-menu/`, `dialog/`, `validation/`, `services/`
- Move files:
  - `app.js` → `constructor/app.js`
  - `lock-manager.js` → `constructor/lock-manager.js`
  - `storage-manager.js` → `constructor/storage-manager.js`
  - `navigation-manager.js` → `constructor/navigation-manager.js`
  - `header-exit.js` → `constructor/header/header-exit.js`
  - `acts-menu.js` → `constructor/header/acts-menu.js`
  - `format-menu-manager.js` → `constructor/header/format-menu-manager.js`
  - `preview-menu.js` → `constructor/header/preview-menu.js`
  - `settings-menu.js` → `constructor/header/settings-menu.js`
  - `state/*` → `constructor/state/*`
  - `tree/*` → `constructor/tree/*`
  - `items/*` → `constructor/items/*`
  - `table/*` → `constructor/table/*`
  - `textblock/*` → `constructor/textblock/*`
  - `violation/*` → `constructor/violation/*`
  - `preview/*` → `constructor/preview/*`
  - `context-menu/*` → `constructor/context-menu/*`
  - `dialog/dialog-help.js` → `constructor/dialog/dialog-help.js`
  - `dialog/dialog-invoice.js` → `constructor/dialog/dialog-invoice.js`
  - `validation/*` → `constructor/validation/*`
  - `services/*` → `constructor/services/*`

**Step 1:** Create directories and copy files

**Step 2:** Commit

```bash
git add static/js/constructor/
git commit -m "Добавлены constructor JS-файлы в новую структуру"
```

---

### Task 10: Phase 3 verification

**Agent:** Team Lead

At this point both OLD and NEW JS files exist. Templates still reference old paths, so app works as before.

**Step 1:** Verify old paths still serve correctly (templates unchanged)
**Step 2:** Verify new files exist at expected paths:
```bash
ls static/js/shared/app-config.js
ls static/js/portal/portal-sidebar.js
ls static/js/constructor/app.js
```

```bash
git tag phase-3-js-done
```

---

## Phase 4: Portal Templates Restructure

### Task 11: Create base_portal.html and shared templates

**Agent:** Frontend
**Purpose:** Create new base portal template and shared template directory

**Files:**
- Create: `templates/shared/auth_error.html` (copy from `templates/components/auth_error.html`)
- Create: `templates/shared/chat_content.html` (copy from `templates/components/chat_content.html`)
- Create: `templates/shared/dialog.html` (copy from `templates/components/dialog.html`)
- Create: `templates/portal/layout/sidebar.html` (copy from `templates/components/landing_sidebar.html`)
- Create: `templates/portal/layout/topbar.html` (copy from `templates/components/landing_topbar.html`)
- Create: `templates/portal/layout/settings_menu.html` (copy from `templates/components/settings_menu.html`)
- Create: `templates/portal/base_portal.html`

**Step 1:** Create directories

```
templates/shared/
templates/portal/
templates/portal/layout/
templates/portal/landing/
templates/portal/acts-manager/
templates/portal/acts-manager/components/
templates/portal/ck/
```

**Step 2:** Copy shared component templates

**Step 3:** Copy portal layout templates

**Step 4:** Create `templates/portal/base_portal.html`

This base template extracts the common structure from landing.html / acts_manager.html / ck_*.html:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{% block title %}Конструктор актов{% endblock %}</title>
    <link rel="stylesheet" href="{{ url_for('static', path='css/entry/portal.css') }}">
    {% block extra_css %}{% endblock %}
</head>
<body>
<div class="sidebar-layout">
    {% include 'portal/layout/sidebar.html' %}
    <main class="sidebar-layout-main">
        {% include 'portal/layout/topbar.html' %}
        {% include 'portal/layout/settings_menu.html' %}
        {% block content %}{% endblock %}
    </main>
</div>

<!-- Modal chat (available on all portal pages) -->
<div id="chatModalOverlay" class="chat-modal-overlay hidden">
    <div class="chat-modal-container">
        {% include 'shared/chat_content.html' %}
    </div>
</div>

{% include 'shared/auth_error.html' %}

<!-- Shared JS -->
<script src="{{ url_for('static', path='js/shared/app-config.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/auth.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/notifications.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/dialog/dialog-base.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/dialog/dialog-confirm.js') }}"></script>

<!-- Portal JS -->
<script src="{{ url_for('static', path='js/portal/portal-sidebar.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-manager.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-modal.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/portal-settings.js') }}"></script>

{% block extra_js %}{% endblock %}

{% block init_script %}{% endblock %}
</body>
</html>
```

**Step 5:** Commit

```bash
git add templates/shared/ templates/portal/base_portal.html templates/portal/layout/
git commit -m "Создан base_portal.html и shared/portal layout шаблоны"
```

---

### Task 12: Migrate portal page templates

**Agent:** Frontend
**Purpose:** Rewrite portal pages to extend base_portal.html

**Step 1:** Create `templates/portal/landing/landing.html`

Extends `base_portal.html`, overrides `{% block content %}` with landing-specific content (chat panel inline + workflow panel). Override `{% block init_script %}` with landing initialization. Note: landing page has INLINE chat (not modal), so it overrides the chat layout.

**Step 2:** Create `templates/portal/acts-manager/acts_manager.html`

Extends `base_portal.html`, overrides content block. Adds acts-manager specific scripts in `{% block extra_js %}`:
```html
{% block extra_js %}
<script src="{{ url_for('static', path='js/constructor/lock-manager.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/acts-manager/dialog-create-act.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/acts-manager/acts-manager-page.js') }}"></script>
{% endblock %}
```

Copy acts components: `templates/portal/acts-manager/components/` ← from `templates/components/acts/`

**Step 3:** Create `templates/portal/ck/ck_fin_res.html` and `ck_client_experience.html`

Extend `base_portal.html`, minimal content block with stub message.

**Step 4:** Update `app/routes/portal.py` template paths

```python
# Old:
templates.TemplateResponse("landing.html", ...)
# New:
templates.TemplateResponse("portal/landing/landing.html", ...)
```

Update all 4 routes to use new template paths.

**Step 5:** Verify portal pages load correctly

**Step 6:** Commit

```bash
git add templates/portal/ app/routes/portal.py
git commit -m "Миграция портальных шаблонов на base_portal.html"
```

---

### Task 13: Phase 4 verification

**Agent:** Team Lead

**Step 1:** Start server
**Step 2:** Check all portal pages:
- `GET /` — landing with sidebar, topbar, inline chat, workflow
- `GET /acts` — acts manager with cards, create button, modal chat
- `GET /ck-fin-res` — stub with sidebar
- `GET /ck-client-experience` — stub with sidebar
**Step 3:** Check sidebar navigation links work between pages
**Step 4:** Check chat works (inline on landing, modal on other pages)
**Step 5:** Browser console — no 404s

```bash
git tag phase-4-portal-done
```

---

## Phase 5: Constructor Templates Restructure

### Task 14: Create base_constructor.html and migrate constructor

**Agent:** Frontend
**Purpose:** Create constructor base template, move constructor-specific templates

**Files:**
- Create: `templates/constructor/` directory structure
- Create: `templates/constructor/base_constructor.html`
- Move: all header/ and constructor components

**Step 1:** Create directory structure

```
templates/constructor/
templates/constructor/header/
templates/constructor/help/
templates/constructor/components/
```

**Step 2:** Copy constructor templates

- `templates/header/*` → `templates/constructor/header/*`
- `templates/header/help/*` → `templates/constructor/help/*`
- `templates/components/tree_panel.html` → `templates/constructor/components/tree_panel.html`
- `templates/components/preview_panel.html` → `templates/constructor/components/preview_panel.html`
- `templates/components/context_menu.html` → `templates/constructor/components/context_menu.html`
- `templates/components/invoice_dialog.html` → `templates/constructor/components/invoice_dialog.html`

**Step 3:** Create `templates/constructor/base_constructor.html`

Replace old `base.html`. Reference new JS/CSS paths:
- CSS: `css/entry/constructor.css` instead of `css/main.css`
- All JS script tags use `js/shared/...` or `js/constructor/...` paths
- All template includes use `constructor/header/...` and `constructor/components/...` paths
- Shared includes use `shared/...` paths

This is the largest single file change. It must reproduce the exact same script loading order as current `base.html`, but with new paths.

**Step 4:** Create `templates/constructor/constructor.html`

```html
{% extends "constructor/base_constructor.html" %}

{% block content %}
<!-- Same content as current constructor.html -->
<div class="container">
    <div id="step1" class="step-content">
        <div class="panels">
            {% include "constructor/components/tree_panel.html" %}
            {% include "constructor/components/preview_panel.html" %}
        </div>
    </div>
    <!-- ... step2 ... -->
</div>
{% include "constructor/components/context_menu.html" %}
{% endblock %}
```

**Step 5:** Update `app/routes/constructor.py` template path

```python
# Old:
templates.TemplateResponse("constructor.html", ...)
# New:
templates.TemplateResponse("constructor/constructor.html", ...)
```

**Step 6:** Verify constructor loads correctly

**Step 7:** Commit

```bash
git add templates/constructor/ app/routes/constructor.py
git commit -m "Миграция шаблонов конструктора на base_constructor.html"
```

---

### Task 15: Cleanup — remove old files and directories

**Agent:** Frontend
**Purpose:** Remove original files that have been copied to new locations

**CRITICAL:** Only remove files AFTER verifying the app works with new paths.

**Step 1:** Remove old JS files (originals that were copied, not moved)

Delete from `static/js/` root: `app-config.js`, `auth.js`, `api.js`, `notifications.js`,
`chat-manager.js`, `chat-modal.js`, `landing-sidebar.js`, `landing-settings.js`,
`landing-page.js`, `acts-manager-page.js`, `app.js`, `lock-manager.js`,
`storage-manager.js`, `navigation-manager.js`, `header-exit.js`, `acts-menu.js`,
`format-menu-manager.js`, `preview-menu.js`, `settings-menu.js`

Delete old JS subdirectories: `static/js/dialog/`, `static/js/state/`, `static/js/tree/`,
`static/js/items/`, `static/js/table/`, `static/js/textblock/`, `static/js/violation/`,
`static/js/preview/`, `static/js/context-menu/`, `static/js/validation/`, `static/js/services/`

**Step 2:** Remove old CSS directories

Delete: `static/css/modules/`, `static/css/layout/`, `static/css/utilities/`
Delete: `static/css/main.css` (replaced by entry points)
Keep: `static/css/base/` (still used by entry/shared.css)

**Step 3:** Remove old template files

Delete: `templates/base.html`, `templates/landing.html`, `templates/acts_manager.html`,
`templates/constructor.html`, `templates/ck_fin_res.html`, `templates/ck_client_experience.html`
Delete: `templates/header/` directory
Delete: `templates/components/` directory

**Step 4:** Final verification — all pages work

**Step 5:** Commit

```bash
git add -A
git commit -m "Удалены старые файлы после миграции в новую структуру"
```

---

### Task 16: Final verification and tag

**Agent:** Team Lead

**Step 1:** Full app test — all pages, all interactions
**Step 2:** Check no orphan files remain
**Step 3:** Verify git status is clean

```bash
git tag phase-5-refactoring-complete
```

---

## Risk Mitigation

1. **Files copied, not moved** during Phase 3 — allows rollback if template migration fails
2. **CSS bridge via main.css** during Phase 2 — old templates work while we transition
3. **Each phase committed separately** — can revert any phase independently
4. **Phase tags** — easy to identify and rollback to any checkpoint
5. **Proxy paths** — `url_for('static', path=...)` handles path construction regardless of file location; `AppConfig.api.getUrl()` is path-independent (uses `window.location`)
