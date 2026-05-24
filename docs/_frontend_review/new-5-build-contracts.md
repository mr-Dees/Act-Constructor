# NEW-5: Build/Deploy + Backend API Contracts

> Аудит NEW-5: разбор того, как фронт (vanilla JS, ~92 JS-файла, ~78 CSS) собирается/отдаётся/инвалидируется, и инвентарь backend HTTP-контрактов с cross-check от фронт-вызовов. Базис: `app/main.py`, `app/core/config.py`, `templates/`, `static/`, `app/api/**`, `app/domains/*/api/**`.

---

## ЧАСТЬ 1: Build / Deploy

### §A. Static files serving

**Точка монтирования** — `app/main.py:344-348`:

```python
app.mount(
    "/static",
    StaticFiles(directory=str(settings.static_dir)),
    name="static"
)
```

`settings.static_dir` = `<project_root>/static` (см. `app/core/config.py:189-192`). Имя роута `static` используется в шаблонах через `url_for('static', path='js/...')` — корректно работает потому, что `HTTPSRedirectMiddleware` форсит схему через `X-Forwarded-Proto` (см. `app/core/middleware.py:28-48`), что нужно для корректного `url_for()` за JupyterHub-proxy.

**Кеш-заголовки** — **по умолчанию от Starlette `StaticFiles`**. Starlette ставит:

- `last-modified: <mtime файла в HTTP-формате>`
- `etag: "<hash от mtime+size>"`
- НЕ ставит `cache-control` (нет ни `max-age`, ни `no-cache`).
- При повторном запросе с `If-None-Match`/`If-Modified-Since` отдаёт **304 Not Modified**.

Браузеры в этом случае применяют **эвристическое кеширование** (RFC 7234 §4.2.2): обычно `(now - last_modified) * 0.1`. Для свежезадеплоенного файла — это короткое окно (минуты), но для давно не менявшегося — может быть **часы/дни** в свежем кеше без перевалидации.

**Под JupyterHub-proxy** (Datalab) — proxy транзитом пропускает `last-modified`/`etag`, никаких дополнительных Cache-Control заголовков не добавляется (проверено: в `app/main.py` нет middleware, который бы навешивал что-то на статику; единственные `Cache-Control: no-cache` — в SSE-эндпоинтах `messages.py:321` и `forward_resume.py:268`).

**Middleware-цепочка** (`app/main.py:308-341`, в порядке навешивания, исполняется в обратном):
1. `RequestIdMiddleware` (первый в исполнении)
2. `HttpMetricsMiddleware`
3. `RateLimitMiddleware` (1024 req/min/IP по умолчанию — пишет статику тоже)
4. `RequestSizeLimitMiddleware`
5. `HTTPSRedirectMiddleware` (последний)

→ Статика **тоже идёт через rate-limit и метрики**. Для статики это лишняя нагрузка; при инкогнито-cold-load одной страницы конструктора браузер берёт ~92 JS + ~78 CSS = ~170 запросов, что съест почти 17% дефолтного rate-limit окна одного пользователя. Под одну вкладку — ОК; под несколько одновременных reload'ов уже близко к лимиту.

### §B. Cache-busting [HIGH]

**Текущее состояние:** Все 124 ссылки `url_for('static', ...)` в `templates/` отдают URL без query/hash. Зависим целиком от ETag-валидации и эвристики браузера.

**Проблема для юзера:** Сразу после выкатки правок (`git pull && перезапуск`) пользователь может:
- Не увидеть изменения вовсе (если файл недавно не менялся и закеширован «свеже» по эвристике).
- Увидеть **рассинхрон**: HTML обновился, JS — нет, → `undefined is not a function` в console. Особенно неприятно при mismatch между `chat-event-bus.js` и его потребителями: load-bearing порядок инициализации ломается тихо.
- Лечение через Ctrl+F5 на каждой странице — в `docs/frontend-constructor-as-is.md` §8.3 явно отмечено: «бесит особенно на JupyterHub».

Существующий as-is doc (`docs/frontend-constructor-as-is.md:1289-1291`) уже фиксирует это как известный долг.

**Реальные заголовки в proxy:** `last-modified` + `etag` есть всегда; `Cache-Control` отсутствует. Браузер сам решает по эвристике 10% от age. Для часто меняющихся файлов (`chat-messages.js`) практическая инвалидация работает; для стабильных модулей (`app-config.js`, `notifications.js`) кеш может жить долго.

#### Вариант 1: `?v={app_version}` query-параметр

В `app/core/config.py` уже есть `app_version: str = "1.0.0"` (Settings). Добавить в Jinja-globals (`app/core/templating.py`) переменную `app_version`, переписать base templates на `{{ url_for('static', path='...') }}?v={{ app_version }}`.

Pro:
- ~10 правок в `base_portal.html` + `base_constructor.html` (одна строка-хелпер или массовая замена).
- Один централизованный bump перед деплоем (изменил `APP_VERSION` в `.env`/коде → новый ETag-неконфликтный URL).
- Под прокси работает без изменений (query параметры не вызывают proxy-redirect).

Con:
- Между деплоями версия не меняется — для dev-цикла с авто-reload бесполезно (но в dev и так есть `reload=True` uvicorn, кеш проблема только в prod).
- Если разные файлы выкатываются разными PR'ами с одной версией — общий bump на всё подряд, лишний 200 на нетронутые файлы (через ETag → реально только 304, но без `Cache-Control` ещё и round-trip).

Effort: **S / 1-2ч**.

#### Вариант 2: mtime-хеш per-file

Хелпер в `app/core/templating.py`:

```python
def static_url(path: str) -> str:
    abs_path = settings.static_dir / path
    try:
        v = int(abs_path.stat().st_mtime)
    except OSError:
        v = 0
    return f"/static/{path}?v={v}"  # + root_path handle через Request
```

Опционально — `lru_cache(maxsize=512)` (но нужна инвалидация при reload в dev).

Pro:
- Каждый файл инвалидируется отдельно — поменял один JS, остальные остались в кеше.
- Работает и в dev: при правке `chat-messages.js` mtime меняется, URL пересчитывается.

Con:
- Каждый рендер шаблона делает `stat()` на ~30 файлов — overhead заметен на slow-storage. На локальной NVMe — наносекунды.
- Нужно протащить `request` для корректного `root_path` (или дублировать логику prefix в helper'е).
- Меняет API: `{{ static('js/...') }}` вместо `{{ url_for('static', path='js/...') }}` — 124 ссылки переписать.

Effort: **M / 4-6ч** (включая тесты под dev/prod-режим).

#### Вариант 3: build-step с hash в имени файла

Например, `chat-messages.a3f9b1.js`. Требует Python-скрипт preBuild + manifest.json для шаблонов.

Pro: «правильно» по индустрии. `Cache-Control: max-age=31536000, immutable` ставится без рисков.

Con: ломает «без бандлера» принцип; добавляет build-step, который в этом проекте сознательно избегается; усложняет git diff. Manifest надо коммитить или регенерировать на каждом prod-старте.

Effort: **L / 1-2 дня** (включая Dockerfile/launch script правки).

**Рекомендация:** Вариант 1 — минимальное изменение, закрывает 80% проблемы (синхронность всех файлов на одной версии = нет mismatch между HTML и JS, главный болевой кейс). Вариант 2 — следующий уровень, если в проде станет важно избегать «весь кеш сброшен ради одной строчки».

### §C. Source maps

- Минификации **нет** — все файлы в `static/js/` отдаются как написаны (~92 .js файла, никакого `.min.js` в кодовой базе кроме `static/vendor/dompurify/purify.min.js`).
- Source maps **нет**. Единственный `.map` упомянут только в комментарии `//# sourceMappingURL=purify.min.js.map` внутри `purify.min.js` (и сам `.map`-файл в репо **отсутствует** — `ls static/vendor/dompurify` показал только `purify.min.js`, при попытке DevTools открыть `.map` будет 404).
- Можно ли отдать devtools-friendly код в проде? Уже отдаётся — это и есть единственный код. Минификации нет → debug в DevTools «как есть» (плюс ES6+, читаемо). Это плюс для текущей архитектуры — нет смысла внедрять `.map`, пока нет минификации.

**Findings:** добавить `purify.min.js.map` в `static/vendor/dompurify/` (скачать из релиза DOMPurify) или удалить строку `//# sourceMappingURL=...` из `purify.min.js` — иначе при открытии DevTools всегда 404 в Network.

### §D. Bundler — анализ нужен ли

**Реальная статистика:**
- 92 JS-файла, ~10-15 одновременно используются на одной странице constructor через `base_constructor.html` (там ~50 `<script>`-тегов).
- HTTP/2 multiplexing у JupyterHub-proxy (предположительно — стоит проверить) делает накладные расходы на много мелких запросов **низкими**.
- HTTP/1.1 с 6 параллельных соединений на origin (browser limit) — последовательная подгрузка 50 скриптов даёт waterfall ~5-10с при cold-load на медленной сети.

**Опции (без перехода на React/Vue):**

| Tool | Setup | Bundle size win | Maintenance |
|---|---|---|---|
| **esbuild** | Один CLI-вызов `esbuild --bundle static/js/entry/constructor.js --outfile=dist/constructor.js`. Требует переписать ~50 `<script>` тегов в один + явные `import`/`export` в каждом модуле. | 50 файлов → 1 файл (~400KB → ~150KB minified). | Появляется `dist/`, build-step в deploy. |
| **rollup** | Похоже на esbuild, лучше для tree-shaking, но в этом проекте всё side-effect-based (window.X публикуется) → tree-shaking не сработает. | Без win над esbuild для этой архитектуры. | Высокий: переписать стиль всех модулей. |
| **Не делать** | 0 эффорта. | 0. | 0. |

**Реальное ограничение:** все singleton-публикации в `window.X` (документировано в CLAUDE.md «Singleton-публикация в `window`»). Переход на бандл означает либо:
- (a) сохранить старый стиль `window.X = ...` в каждом файле → бандл просто конкатенация (как `cat *.js > bundle.js`), ничего не теряем, но и не сильно выигрываем;
- (b) переписать на ESM с `import/export` → load-bearing рефакторинг 90 файлов + тесты.

**Рекомендация:** не внедрять бандлер сейчас. Ценность только в скорости cold-load, и она лечится HTTP/2 + cache-busting (§B). Бандлер добавляет build-step, который проект явно избегал (см. README раздел «Frontend» — «без фреймворков»).

Если в будущем будет нужно — esbuild + Вариант (a) (конкатенация с сохранением `window.X`) даст ~3x ускорение cold-load одной правкой `python -m esbuild ...` в Dockerfile, без переписывания самих файлов.

### §E. CSS preprocessing

**Сколько импортов:**
- `static/css/entry/constructor.css` — **46** `@import`
- `static/css/entry/portal.css` — **22** `@import`
- `static/css/entry/shared.css` — **15** `@import`

Браузер обрабатывает `@import` **последовательно**: после загрузки родителя видит `@import`, делает новый запрос, ждёт ответ, потом следующий. Это **render-blocking** — страница не отрисовывается до загрузки всей цепочки. На constructor.css это ~46 round-trips на cold-load.

С HTTP/2 multiplexing — сильно меньшая проблема (запросы параллелятся), но всё равно: каждый `@import` блокирует CSSOM, пока не загрузится. CSSOM завершён только когда последний CSS файл готов.

**Caching:** статика по умолчанию ETag-кешируется (см. §A). Повторные визиты — 304 на каждый, без полного body. Это нормально работает.

**CSS minification:** нет. На read'е файлов комментарии и whitespace = ~30% оверхеда. После gzip от reverse-proxy (если включён) — некритично.

**Quick wins:**
1. Минимально: добавить cache-busting (§B) к `entry/*.css` тоже — те же 3 entry-CSS файла затронуты.
2. Средне: использовать `<link rel="stylesheet">` для каждого модуля вместо `@import` в entry (параллелизация HTTP/2 без последовательности). Но это переезд 124 импортов в HTML — много правок.
3. Радикально: `esbuild --bundle static/css/entry/constructor.css --outfile=...` — 46 файлов → 1 minified. Идёт в паре с JS-бандлером, не отдельно.

### §F. Environment configuration

**Что инжектится во фронт:**
- Из jinja-контекста (через base templates):
  - `chat_domains` (meta tag) — `templates/portal/base_portal.html:6`, `templates/constructor/base_constructor.html:6`.
  - `knowledge_bases` (meta tag) — там же, строка 7.
- Через runtime fetch:
  - `/api/v1/auth/me` → username (cached в `localStorage` на 24ч, см. `auth.js`).
  - `/api/v1/acts/config/lock` → ActsSettings.lock (`AppConfig.lock` fallback в `app-config.js:102-143`).
  - `/api/v1/acts/config/invoice` → ActsSettings.invoice (схемы Hive/GP, `dialog-invoice.js:178`).
  - `/api/v1/chat/limits` → ChatDomainSettings.files (`chat-files.js:83`).
- Конфиг определяется в `static/js/shared/app-config.js` как статические данные в class fields — хардкод (территориальные банки, лимиты узлов дерева, таблицы-пресеты, тексты ошибок, иконки и т.д.). Не инжектится с бэка — только хардкод.

**Production vs dev отличия на фронте:** нет явных отличий. JS одинаков. Различия только в:
- `root_path` (jinja `url_for` ставит правильный префикс).
- `chat_domains` для конкретной страницы (зависит от `nav_items`).
- `AuthManager`: в dev `JUPYTERHUB_USER` берётся из `.env`, в prod — из реального env-vara.

**Findings:**
- `AppConfig.api.getUrl()` принимает endpoint и склеивает с `proxy_match[1]` или `origin`. Логика в **`app-config.js:51-91`** — единая точка истины. Изменения proxy-формата (если JupyterHub изменит layout) затронут только её.
- `process.env`-style инжекции **нет** — нельзя сказать «эта сборка для stage, эта — для prod». Если понадобится — придётся добавить либо meta-tag, либо global JS-vars в base template из jinja-context.

### §G. Versioning UI

**Backend:**
- `GET /api/v1/system/version` (`app/api/v1/endpoints/system.py:107-114`) возвращает `{service, version, api_version}`.
- `GET /api/v1/system/health/detailed` тоже включает `version`.

**Frontend:**
- Ни одного вызова `/api/v1/system/version` или `/api/v1/system/health*` в `static/js/**` (grep подтвердил).
- Версия **не отображается** ни в `topbar.html`, ни в каком-либо footer (grep по `version|VERSION` в `templates/` — только в `audit_log_dialog.html` и `acts_manager.html`, но это не app-version).
- При rollback пользователь **никак не поймёт**, что версия откатилась — фронт у него тот же из браузер-кеша, бэк-API те же endpoints.

**Findings (HIGH):**
- Endpoint `/api/v1/system/version` существует, но никем не используется — кандидат либо подключить (см. ниже), либо выпилить.
- Минимальный fix: добавить version в `topbar.html` (label под `currentUserName` или title attribute), фетчить раз при загрузке. ~30 строк JS, 5 строк HTML.
- Полнее: meta-tag `<meta name="app-version" content="{{ app_version }}">` в base templates → доступ без round-trip. Это же значение можно использовать как `?v=` для cache-busting (Вариант 1 §B).

### §H. CI/CD

**Что есть:**
- `.github/` — **отсутствует**. `ls .github 2>&1` → "No such file or directory".
- `.gitlab-ci.yml` — нет.
- `Dockerfile` — нет.
- `docker-compose.yml` — нет.
- `scripts/launch_datalab.py` — единственный «деплой-скрипт»: интерактивно делает `kinit` в Jupyter-ноутбуке и запускает `python -m app.main` через `subprocess.run`.

**Findings (HIGH):**
- CI/CD pipeline **отсутствует**.
- Нет автоматического lint (ruff/black/eslint), нет автоматических pytest на PR.
- Деплой ручной: каждый разработчик в JupyterHub перезапускает `launch_datalab.py` в своём space. Multi-environment promotion (dev → staging → prod) **не формализован**.
- Это даёт сильное побочное последствие для cache-busting: без CI/CD и build-step Вариант 3 (hash в имени файла) практически невыполним без переделки процесса деплоя.

Минимум: завести `.github/workflows/test.yml` с `pytest` + `ruff check app/` на PR. Это блокирует мерж разломанных тестов и даёт быструю обратную связь.

### §I. Dependencies

**Backend** (`requirements.txt`, `requirements-dev.txt`) — pip-managed, версии в txt.

**Frontend:**
- `package.json` — **нет на верхнем уровне** (find показал только playwright в `node_modules/`, который — артефакт MCP playwright плагина, не зависимость проекта).
- Vendor: единственная сторонняя — `static/vendor/dompurify/purify.min.js`. Без `package.json` / без lockfile → версия неизвестна (надо открыть файл и посмотреть в шапке). Обновление — вручную: скачать новый purify.min.js → положить файл.
- `.gitignore` явно содержит `package.json` и `package-*.json` (строки 24-25 gitignore) — то есть **решение: не использовать npm**. `node_modules/` тоже в ignore.

**Findings:**
- При CVE в DOMPurify нет автоматического уведомления (нет dependabot/snyk). Контроль — ручной обход новостей.
- Если появятся ещё vendor-зависимости (codemirror/quill для richtext, prism/highlight для подсветки кода чата) — стоит зафиксировать пиннинг через `static/vendor/VERSIONS.md` или аналог, чтобы хотя бы версии были задокументированы.

### §J. Monitoring / observability

**Frontend error tracking:**
- Sentry/Rollbar/самописное — **нет ни одного** (grep по `Sentry|Rollbar|errorTracker|reportError|window.onerror` в `static/js/` — 0 совпадений).
- Логирование клиентских ошибок: только `console.error()` / `console.warn()` в кодовой базе. Если у пользователя «не работает» — узнать можно только по скриншоту от него или прислав DevTools-Console-output.

**Real user metrics (RUM):** нет.

**Backend наблюдаемость:**
- `HttpMetricsMiddleware` пишет HTTP-метрики в БД через `admin.http_metrics_batcher`. Есть `/api/v1/admin/diagnostics` (admin-only) с состоянием батчеров.
- Frontend этим не пользуется (см. §K orphan).

**Findings (MEDIUM):**
- Логировать клиентские ошибки на бэк — простой эндпоинт `POST /api/v1/system/client-error` с rate-limit + `window.onerror` хук на фронте даст видимость в JS-багах без зависимости от пользователя.
- `/api/v1/admin/diagnostics` имеет смысл подключить в admin-панель (сейчас orphan на фронте).

### Итог: топ-5 quick wins для deploy

1. **[HIGH] Cache-busting Вариант 1** (`?v={app_version}` в base templates) — 1-2ч, закрывает основной болевой кейс юзера; уже описано в `docs/frontend-constructor-as-is.md` §8.3 как известный долг.
2. **[HIGH] Версия в UI** — добавить `app_version` в jinja-globals + meta-tag в base templates + label в `topbar.html`. Один артефакт, который сразу даёт (a) видимость версии и (b) переменную для cache-busting.
3. **[MEDIUM] Минимальный CI** — `.github/workflows/test.yml`: pytest + ruff на PR. Без deploy-этапа, только защита от регрессий.
4. **[MEDIUM] Frontend error logging** — `window.onerror`/`window.addEventListener('unhandledrejection')` → `POST /api/v1/system/client-error` (новый endpoint) с rate-limit. Закрывает «у пользователя что-то не работает» — теперь видно в логах.
5. **[LOW] Source map для DOMPurify** — положить `purify.min.js.map` рядом с минифай-файлом ИЛИ удалить `//# sourceMappingURL=...` строку. Сейчас при открытии DevTools перманентный 404.

---

## ЧАСТЬ 2: Backend API contracts

> Реестр всех HTTP endpoints + проверка вызовов из фронта. Префикс `/api/v1` опускаем для краткости в URL; полный URL = `<root_path>/api/v1<endpoint>`.

### §K. Полный inventory endpoints

**Shared (`app/api/v1/endpoints/`)** — подключены без role-guard на уровне `domain_registry` (это shared эндпоинты, монтируются напрямую через `api_v1_router`):

| Method | URL | Handler | Request | Response | Auth | Role | Called from frontend |
|---|---|---|---|---|---|---|---|
| GET | `/auth/me` | `get_current_user` | — | `AuthResponse{authenticated, username, display_name}` | нет (всегда 200) | — | **Да** — `static/js/shared/auth.js:134` |
| GET | `/auth/validate` | `validate_session` | — | `{valid, username}` или 401 | да | — | **Нет** (orphan, 0 ссылок) |
| GET | `/system/health` | `health_check` | — | `{status, service, version}` | нет | — | **Нет** (orphan; для load-balancer'ов) |
| GET | `/system/health/detailed` | `detailed_health_check` | — | `{status, service, version, timestamp}` | нет | — | **Нет** (orphan) |
| GET | `/system/health/detailed/full` | `detailed_health_check_full` | — | `{status, service, version, env}` | да | — | **Нет** (orphan) |
| GET | `/system/health/{domain_name}` | `domain_health` | — | `{status, domain, ...}` | нет | — | **Нет** (orphan) |
| GET | `/system/version` | `get_version` | — | `{service, version, api_version}` | нет | — | **Нет** (orphan) |
| GET | `/roles/my-roles` | `get_my_roles` | — | `{username, roles, is_admin}` | да | — | **Да** — `api.js:936` |
| GET | `/admin/diagnostics` | `diagnostics` | — | `{batchers, background_tasks}` | да | Админ | **Нет** (orphan) |

**Acts domain (`/api/v1/acts/...`)**:

| Method | URL | Handler | Request | Response | Auth | Role | Called from frontend |
|---|---|---|---|---|---|---|---|
| GET | `/acts/list` | `list_user_acts` | — | `list[ActListItem]` | да | acts | **Да** — `acts-manager-page.js:218`, `header/acts-menu.js:101` |
| POST | `/acts/{act_id}/lock` | `lock_act` | — | `LockResponse` | да | acts | **Да** — `api.js:12`, `lock-manager.js:148` |
| POST | `/acts/{act_id}/unlock` | `unlock_act` | — | `OperationResult` | да | acts | **Да** — `api.js:30`, `lock-manager.js:90,491` (+ `sendBeacon` :325) |
| POST | `/acts/{act_id}/extend-lock` | `extend_lock` | — | `LockResponse` | да | acts | **Да** — `api.js:48`, `lock-manager.js:225` |
| POST | `/acts/create` | `create_act` | `ActCreate` + `?force_new_part=bool` | `ActResponse` (201) | да | acts | **Да** — `dialog-create-act.js:1224,1310,1378` |
| GET | `/acts/config/lock` | `get_lock_config` | — | `LockConfigResponse` | да | acts | **Да** — `lock-manager.js:114` |
| GET | `/acts/config/invoice` | `get_invoice_config` | — | `InvoiceConfigResponse` | да | acts | **Да** — `dialog-invoice.js:178` |
| GET | `/acts/{act_id}` | `get_act` | — | `ActResponse` | да | acts | **Да** — `api.js:553`, `acts-manager-page.js:464`, `header/acts-menu.js:423` |
| PATCH | `/acts/{act_id}` | `update_act_metadata` | `ActUpdate` | `ActResponse` | да | acts | **Да** — `dialog-create-act.js:1225` (method PATCH) |
| POST | `/acts/{act_id}/duplicate` | `duplicate_act` | — | `ActResponse` | да | acts | **Да** — `acts-manager-page.js:569`, `header/acts-menu.js:463` |
| POST | `/acts/{act_id}/audit-point-ids` | `generate_audit_point_ids` | `AuditPointIdsRequest{node_ids}` | `dict[node_id, audit_point_id]` | да | acts | **Да** — `id-generator.js:28` |
| DELETE | `/acts/{act_id}` | `delete_act` | — | `OperationResult` | да | acts | **Да** — `acts-manager-page.js:638` |
| GET | `/acts/{act_id}/content` | `get_act_content` | — | `dict` (full content) | да | acts | **Да** — `api.js:311`, `lock-manager.js`, `dialog-create-act.js:64` |
| PUT | `/acts/{act_id}/content` | `save_act_content` | `ActDataSchema` | `SaveContentResponse` | да | acts | **Да** — `api.js:457`, `api.js:501`, `api.js:835`, `lock-manager.js:463` |
| GET | `/acts/{act_id}/invoices` | `get_act_invoices` | — | `list[dict]` | да | acts | **Нет** (orphan — grep 0 совпадений на endpoint в JS) |
| POST | `/acts/export/save-act` | `save_act` | `ActDataSchema` + `?fmt&act_id` | `ActSaveResponse` | да | acts | **Да** — `api.js:131` |
| GET | `/acts/export/download/{filename}` | `download_act` | — | `FileResponse` | да | acts | **Да** — `api.js:259` |
| GET | `/acts/invoice/metrics` | `list_metrics` | — | `list[dict]` | да | acts | **Да** — `api.js:641` |
| GET | `/acts/invoice/processes` | `list_processes` | — | `list[dict]` | да | acts | **Да** — `api.js:661` |
| GET | `/acts/invoice/subsidiaries` | `list_subsidiaries` | — | `list[dict]` | да | acts | **Да** — `api.js:677` |
| GET | `/acts/invoice/tables/{db_type}` | `list_tables` | `db_type: 'hive'|'greenplum'` | `list[dict]` | да | acts | **Да** — `api.js:696` |
| POST | `/acts/invoice/save` | `save_invoice` | `InvoiceSave` | `dict` | да | acts | **Да** — `api.js:718` |
| POST | `/acts/invoice/verify` | `verify_invoice` | `InvoiceVerifyRequest` | `dict` | да | acts | **Да** — `api.js:744` (TODO-заглушка на бэке) |
| GET | `/acts/{act_id}/audit-log` | `get_audit_log` | `?action&username&from_date&to_date&limit&offset` | `AuditLogResponse{items, total}` | да | acts + Куратор/Руководитель | **Да** — `api.js:862` |
| GET | `/acts/{act_id}/versions` | `get_versions` | `?limit&offset` | `ContentVersionsResponse` | да | acts + Куратор/Руководитель | **Да** — `api.js:878` |
| GET | `/acts/{act_id}/versions/{version_id}` | `get_version` | — | `ContentVersionDetail` | да | acts + Куратор/Руководитель | **Да** — `api.js:894` |
| POST | `/acts/{act_id}/versions/{version_id}/restore` | `restore_version` | — | `RestoreVersionResponse` | да | acts + Куратор/Руководитель | **Да** — `api.js:910` |
| GET | `/acts/users/search` | `search_users` | `?q` | `list[UserSearchResult]` | да | acts | **Да** — `api.js:1032` |

**Admin domain (`/api/v1/admin/...`)** — все эндпоинты требуют роль Админ через `_admin = Depends(require_admin())` (defence-in-depth: ещё и через `dependencies` в каждом декораторе):

| Method | URL | Handler | Request | Response | Auth | Role | Called from frontend |
|---|---|---|---|---|---|---|---|
| GET | `/admin/roles` | `list_roles` | — | `list[RoleSchema]` | да | Админ | **Да** — `api.js:949` |
| GET | `/admin/users/directory` | `get_user_directory` | — | `list[UserDirectoryItem]` | да | Админ | **Да** — `api.js:962` |
| GET | `/admin/users/search` | `search_users` | `?q` | `list[UserSearchResult]` | да | Админ | **Да** — `api.js:1017` |
| GET | `/admin/users/{username}/roles` | `get_user_roles` | — | `UserRolesResponse` | да | Админ | **Да** — `api.js:977` |
| POST | `/admin/users/{username}/roles` | `assign_role` | `RoleAssignRequest{role_id}` | `{assigned, detail}` | да | Админ | **Да** — `api.js:977-997` (POST с body) |
| DELETE | `/admin/users/{username}/roles/{role_id}` | `remove_role` | — | `{removed, detail}` | да | Админ | **Да** — `api.js:999` |
| GET | `/admin/audit-log` | `get_audit_log` | `?action&target_username&admin_username&from_date&to_date&limit&offset` | `AuditLogResponse{items, total}` | да | Админ | **Нет** (orphan) |

**Chat domain (`/api/v1/chat/...`)** — все требуют `require_domain_access("chat")` (defence-in-depth: ещё и через `dependencies` на роутере):

| Method | URL | Handler | Request | Response | Auth | Role | Called from frontend |
|---|---|---|---|---|---|---|---|
| POST | `/chat/conversations` | `create_conversation` | `CreateConversationRequest{title?, domain_name?, context?}` | `ConversationResponse` (201) | да | chat | **Да** — `chat-context.js:101`, `chat-history.js:104` |
| GET | `/chat/conversations` | `list_conversations` | `?domain_name&limit&offset` | `list[ConversationListItem]` | да | chat | **Да** — `chat-history.js:52` |
| GET | `/chat/conversations/{conversation_id}` | `get_conversation` | — | `ConversationResponse` | да | chat | **Нет** (orphan — фронт сразу запрашивает сообщения) |
| PATCH | `/chat/conversations/{conversation_id}` | `update_conversation` | `UpdateConversationRequest{title}` | `{updated}` | да | chat | **Нет** (orphan — фронт меняет title только при создании) |
| DELETE | `/chat/conversations/{conversation_id}` | `delete_conversation` | — | `{deleted}` | да | chat | **Да** — `chat-history.js:143` |
| POST | `/chat/conversations/{conversation_id}/messages` | `send_message` | `multipart: message, domains?, files?` | `MessageResponse` или SSE | да | chat | **Да** — `chat-stream.js:448` (SSE) |
| GET | `/chat/conversations/{conversation_id}/messages` | `get_messages` | `?limit&offset` | `list[MessageResponse]` | да | chat | **Да** — `chat-context.js:189` |
| GET | `/chat/conversations/{conversation_id}/active-forward` | `get_active_forward` | — | `{request_id, status, created_at}` или 204 | да | chat | **Да** — `chat-context.js:229` |
| GET | `/chat/conversations/{conversation_id}/forward-stream/{request_id}` | `stream_forward_resume` | `?since_seq (deprecated)` | SSE | да | chat | **Да** — `chat-stream.js:305` |
| GET | `/chat/limits` | `get_chat_limits` | — | `{max_file_size, max_total_file_size, max_files_per_message}` | да | chat | **Да** — `chat-files.js:83` |
| GET | `/chat/files/{file_id}` | `download_file` | `?inline=bool` | binary `application/octet-stream` | да | chat | **Да** — `chat-renderer.js:753` |

**Ck_client_exp domain (`/api/v1/ck-client-exp/...`)** — `require_domain_access("ck_client_exp")`:

| Method | URL | Handler | Request | Response | Auth | Role | Called from frontend |
|---|---|---|---|---|---|---|---|
| POST | `/ck-client-exp/records/search` | `search_records` | `ValidationSearchRequest` | `{data}` | да | ck_client_exp | **Да** — `api.js:1050` (generic prefix-based) |
| GET | `/ck-client-exp/records/{record_id}` | `get_record` | — | `dict` | да | ck_client_exp | **Да** — `api.js:1070` |
| POST | `/ck-client-exp/records` | `create_record` | `CSValidationCreate` | `dict` (201) | да | ck_client_exp | **Да** — `api.js:1084` |
| POST | `/ck-client-exp/records/batch-update` | `batch_update_records` | `list[CSValidationBatchItem]` (max 500) | `{updated}` | да | ck_client_exp | **Да** — `api.js:1103` |
| DELETE | `/ck-client-exp/records/{record_id}` | `delete_record` | — | — (204) | да | ck_client_exp | **Да** — `api.js:1122` |
| GET | `/ck-client-exp/dictionaries/{name}` | `get_dictionary` | `name in {processes,terbanks,metrics,departments,channels,products,teams}` | `{data}` | да | ck_client_exp | **Да** — `api.js:1137` |

**Ck_fin_res domain (`/api/v1/ck-fin-res/...`)** — структура идентична `ck_client_exp`, +1 dictionary `risk_types`. Все вызываются через тот же generic-wrapper `api.js:1050-1137` с `prefix='ck-fin-res'`.

**HTML routes (не API, для полноты):**

| Method | URL | Handler | Auth |
|---|---|---|---|
| GET | `/` | `show_landing` | да |
| GET | `/acts` | `show_acts_manager` | да + acts |
| GET | `/constructor?act_id=X` | `show_constructor` | да + проверка ActAccess по `act_id` |
| GET | `/admin` | `show_admin_page` | да + Админ |
| GET | `/ck-client-experience` | (ck_client_exp/routes/portal) | да + ck_client_exp |
| GET | `/ck-fin-res` | (ck_fin_res/routes/portal) | да + ck_fin_res |
| GET | `/favicon.ico` | `favicon` | нет |
| GET | `/static/*` | StaticFiles | нет |

**Итого API:** **53 endpoints** (shared 9 + acts 24 + admin 7 + chat 11 + ck_client_exp 6 + ck_fin_res 6).

### §L. Orphan endpoints (не вызываются с фронта)

Endpoints с **0 fetch-ссылок** в `static/js/**`:

1. `GET /api/v1/auth/validate` — дубликат функциональности `/auth/me` (только бросает 401 если не auth). Никем не вызван. **Кандидат на выпил или явное предназначение.**
2. `GET /api/v1/system/health` — для health-check load-balancer'ов. Допустим, что используется внешним monitoring'ом (Datalab/JupyterHub probe). **Оставить, но задокументировать.**
3. `GET /api/v1/system/health/detailed` — то же.
4. `GET /api/v1/system/health/detailed/full` — то же, но с авторизацией.
5. `GET /api/v1/system/health/{domain_name}` — per-domain health. Используется только если есть внешний monitoring.
6. `GET /api/v1/system/version` — **должен** использоваться UI (см. §G), сейчас не используется.
7. `GET /api/v1/admin/diagnostics` — **должен** быть подключён в админ-панель (есть готовая зона `/admin`), сейчас нет.
8. `GET /api/v1/admin/audit-log` — аудит-лог админ-операций. **Должен** быть подключён в админ-панель, сейчас нет.
9. `GET /api/v1/acts/{act_id}/invoices` — список всех фактур акта. Возможно, использовался ранее; сейчас фронт работает с фактурами через индивидуальный `save/verify`. **Проверить, не нужно ли подключить в preview/export.**
10. `GET /api/v1/chat/conversations/{conversation_id}` — отдельный get conversation. Фронт всегда сразу запрашивает сообщения (`/messages`) — отдельный GET conversation orphan.
11. `PATCH /api/v1/chat/conversations/{conversation_id}` — обновление title. Title задаётся только при создании (через `ChatTitle.derive` на фронте). **Реальный use-case — переименование чата пользователем — на UI отсутствует**, кнопки переименования в `chat-history.js` нет.

**Итого orphan:** **11 endpoints** из 53 (~21%).

Из них **5 кандидатов «подключить»** (значимая функциональность не выведена в UI): `/system/version` → UI, `/admin/diagnostics` → admin-панель, `/admin/audit-log` → admin-панель, `/acts/{id}/invoices` → constructor/preview, PATCH `/chat/conversations/{id}` → кнопка «переименовать чат» в `chat-history`.

Остальные 6 (`/auth/validate`, 4 `/system/health*`, `/chat/conversations/{id}` GET) — допустимо оставить как внешние/служебные.

### §M. Orphan frontend calls (нет endpoint?)

**Проверка пар URL фронт→бэк:** все уникальные URL из `getUrl('/api/v1/...')` в `static/js/` сматчены с одним из 53 endpoints.

**Дополнительная проверка direct relative-path fetches** (риск 404 под JupyterHub-proxy без `getUrl()`):

- `grep "fetch(\s*['\"]/api"` в `static/js/` → **0 совпадений**.
- `grep "window.location.href\s*=\s*['\"]/"` → **0 совпадений**.

Все вызовы проходят через `AppConfig.api.getUrl(...)` — отлично.

**Sub-tle bug** (`dialog-create-act.js:1378`):

```javascript
const resp = await fetch(AppConfig.api.getUrl(`${endpoint}?force_new_part=true`), {
```

`endpoint` тут — уже **полный URL** из `getUrl(...)` (выше, строка 1310: `await this._createWithNewPart(AppConfig.api.getUrl('/api/v1/acts/create'), ...)`). Двойное оборачивание в `getUrl`:

- `endpoint = 'https://host/user/X/proxy/8005/api/v1/acts/create'`
- `getUrl(`${endpoint}?force_new_part=true`)` → `getUrl('https://host/user/X/proxy/8005/api/v1/acts/create?force_new_part=true')`
- Логика `getUrl`: если endpoint начинается с `/` — отрезается, иначе как есть; затем `baseUrl + '/' + cleanEndpoint`.
- Результат: `https://host/user/X/proxy/8005/https://host/user/X/proxy/8005/api/v1/acts/create?force_new_part=true` — **битый URL**.

→ `_createWithNewPart` упадёт 404 в проде. Возможно, не проявляется потому что fall-through путь редкий (КМ уже существует + пользователь подтвердил создание новой части). Помечен как **[HIGH] BUG**.

Fix: убрать второе `getUrl()`, передавать готовый endpoint напрямую:

```javascript
const resp = await fetch(`${endpoint}?force_new_part=true`, {
```

**Итог:** 0 orphan-frontend-calls (все endpoints существуют), но 1 bug с двойным `getUrl()`.

### §N. Schema mismatches

Полная проверка mismatch'ей требует запуска и трассировки real-payloads. Статический анализ:

1. **`POST /acts/create` `force_new_part`** — на бэке `bool` query parameter (`management.py:69`), на фронте передаётся как `?force_new_part=true` (`dialog-create-act.js:1378`) — **OK** (модулo bug выше).
2. **`POST /acts/save-act` `fmt`** — на бэке `Literal["txt", "md", "docx"]` (`export.py:71`), на фронте передаётся из `format` параметра (`api.js:131`) с теми же значениями — **OK** (но фронт не валидирует, может прислать неверный и получить 422).
3. **`POST /admin/users/{username}/roles`** — `RoleAssignRequest{role_id: int}`, фронт шлёт `{role_id: <int>}` — **OK**.
4. **`POST /chat/conversations`** — `CreateConversationRequest{title?, domain_name?, context?}`, фронт шлёт `{title?, domain_name?}` (без `context`) — **OK** (optional поле).
5. **`POST /chat/conversations/{cid}/messages`** — multipart FormData (`message`, `domains?`, `files?`). На бэке `Form(...)` + `File(default=[])`. Фронт строит `FormData` корректно (`chat-stream.js:425-438`). **OK.**

**Не проверял глубоко** (требуется runtime-проверка):
- `ActDataSchema` (PUT content) ↔ `state-content.js` сериализация — большая схема, риск дрифта при добавлении новых полей.
- `ActCreate` vs `dialog-create-act.js` форма — сложная вложенная структура team/directives.
- `CSValidationCreate` / `FRValidationCreate` ↔ генерик-обёртка в `api.js:1084`.

**Findings:**
- Schema-mismatch автоматических проверок **нет** (нет codegen из OpenAPI на фронт, нет contract tests). Дрифт возможен.
- Решение: пара unit-тестов «golden contract» — фронт-payload, который шлёт `dialog-create-act.js`, дёргаем `ActCreate.model_validate(payload)` в pytest. Если фронт изменил поля — тест падает. Эффорт: 1ч на самый load-bearing endpoint (`/acts/create`).

### §O. Версионирование API

- Только `/api/v1/` — настроено в `app.core.config.ServerSettings.api_v1_prefix = "/api/v1"`.
- Нет `v0`, `v2`. Нет deprecation-механизма заголовков.
- Внутри `v1` есть **deprecation на уровне параметра**: `?since_seq` в `/chat/conversations/{cid}/forward-stream/{rid}` помечен `deprecated=True` в FastAPI signature (`forward_resume.py:109`) — Swagger покажет, но runtime игнорирует. Документировано.
- Один эндпоинт удалён (`/agent-request/{request_id}/stream`, см. комментарий в `messages.py:368-376`).

**Findings:** для текущего размера и monorepo-стиля (фронт и бэк в одном репо, нет внешних потребителей) versioning v1 достаточен. При появлении внешних потребителей (mobile / 3rd party) — придётся вводить v2.

### §P. Pagination consistency

Поведение разных endpoints:

| Endpoint | Pagination params | Response shape |
|---|---|---|
| `GET /acts/{id}/audit-log` | `limit (1..2000)`, `offset (>=0)` | `{items: [...], total: int}` |
| `GET /acts/{id}/versions` | `limit (1..2000)`, `offset (>=0)` | `{items: [...], total: int}` |
| `GET /admin/audit-log` | `limit (1..200)`, `offset (>=0)` | `{items: [...], total: int}` |
| `GET /chat/conversations` | `limit (1..200)`, `offset (>=0)` | `list[ConversationListItem]` (без total!) |
| `GET /chat/conversations/{id}/messages` | `limit (1..500)`, `offset (>=0)` | `list[MessageResponse]` (без total) |
| `POST /ck-*/records/search` | `limit, offset` в body `ValidationSearchRequest` | `{data: [...]}` (без total) |
| `GET /acts/users/search` / `GET /admin/users/search` | без pagination, `q` only | `list[UserSearchResult]` |
| `GET /acts/list` | без pagination | `list[ActListItem]` |

**Findings (MEDIUM):**
1. **Limits разные**: 200 / 500 / 2000 без видимой системы. Aудит-логи могут запрашивать 2000 одной страницей, chat-conversations — только 200. Договоренности по дефолтам нет.
2. **Response shape расходится**: где-то `{items, total}`, где-то голый `list[...]`. На фронте это две разные обработки: для `total` есть пагинация, для просто list — infinite-scroll невозможен без отдельного count-endpoint'а.
3. **Search через POST с pagination в body** vs **GET с pagination в query** — два стиля.

Рекомендация: завести соглашение «все list-endpoints возвращают `{items, total, limit, offset}` или `{data, total}`», задокументировать в developer-guide. Refactor можно мигрировать постепенно (новые endpoints — сразу с total).

### §Q. Error response consistency

**Базовые механизмы (`app/main.py:389-435`):**
- `AppError` (домен-исключения) → JSON `exc.to_detail()` со `status_code` из самого исключения. Структура зависит от подкласса (см. `KmConflictDetail`, `LockErrorDetail`).
- `UniqueViolationError` → 409 `{"detail": "Запись с такими данными уже существует"}`.
- `CheckViolationError` → 422 + маппинг через `CHECK_CONSTRAINT_MESSAGES`.
- `HTTPException` → передаёт `{detail}` как есть (FastAPI default).
- `Exception` (всё остальное) → 500 `{"detail": "Внутренняя ошибка сервера"}` (детали только в логах).
- `KerberosTokenExpiredError` → 401 + сложная структура `{error, detail, message, instructions[], action_required}`.

**Findings:**
- **Тип формата ответа разный**:
  - FastAPI default: `{"detail": "..."}`
  - Domain errors: `exc.to_detail()` — гибкий dict, поля разные для разных подклассов.
  - Kerberos: специальная структура с `instructions[]` + `action_required` (фронт должен уметь распознать `error: "kerberos_token_expired"`).
- **Фронт парсит ошибки неоднородно**: некоторые места ждут `errData.detail`, другие — `errData.type === 'km_exists'` (`dialog-create-act.js:1277`). Если бэк изменит структуру конкретного error-payload'а, фронт молча сломается.
- **Документации единого error envelope нет** — каждый разработчик добавляет свой.

Рекомендация: ввести envelope `{detail: string, code: string, ...extra}`, где `code` — короткий enum (`km_exists`, `kerberos_token_expired`, `chat_limit_exceeded`, ...). Фронт переключается по `code`, не по `error`/`detail` строкам. ~3-4 дня рефакторинга, но окупится резким снижением «непонятных» ошибок у пользователя.

### §R. SSE endpoints

| Endpoint | Direction | Cache-Control | Heartbeat | Семафор |
|---|---|---|---|---|
| `POST /chat/conversations/{cid}/messages` (с `Accept: text/event-stream`) | server → client | `no-cache`, `X-Accel-Buffering: no` | да (`with_heartbeat`) | `_active_streams_per_user[username]++` (chat.max_parallel_streams_per_user) |
| `GET /chat/conversations/{cid}/forward-stream/{rid}` (Resume SSE) | server → client | то же | да | **НЕ** инкрементит семафор (read-only resume, см. `forward_resume.py:10-18`) |

**Все ASGI raw middleware** в `app/core/middleware.py` корректно пропускают SSE (не буферизуют тело — это ключевое требование, документировано в самом файле).

**Auth:** оба эндпоинта требуют `require_domain_access("chat")` + ownership-чек беседы.

**Server-side dedup для Resume SSE** (`forward_resume.py:42-49`, `_active_resume_cancels`): при новом подключении к тому же `request_id` старый получает `set()` event'а и завершается — защита от saturation pool'а при tab-switch'ах. **Эта часть — load-bearing**, в CLAUDE.md явно указано.

### §S. Bulk endpoints

- `POST /ck-client-exp/records/batch-update` — max **500** items (`MAX_BATCH_SIZE` в `records.py:24`).
- `POST /ck-fin-res/records/batch-update` — max **500** items.
- Других batch-endpoints **нет**: `acts/{id}/audit-point-ids` принимает список node_ids, но без явного лимита (на фронте `id-generator.js` шлёт по факту 5-10 узлов).

**Rate limits:** общий `RateLimitMiddleware` (1024 req/min/IP). Per-endpoint rate limit'а нет, кроме chat (per-user `RateLimiter` в `messages.py:92`).

**Findings:**
- Batch-endpoint `acts/{id}/audit-point-ids` без явного лимита размера батча. Если фронт пришлёт 100k node_ids — будет тяжёлый запрос. Рекомендую добавить `MAX_BATCH_SIZE = 200`.
- Отсутствие batch-version у `POST /chat/conversations/{cid}/messages` — для генерации множества сообщений (отчёты) нет другого пути кроме N последовательных запросов. Не критично сейчас.

### Итог: топ-10 contract issues

1. **[HIGH] BUG: `dialog-create-act.js:1378` — двойное `getUrl()`** → битый URL при создании новой части акта (force_new_part flow). Один из путей создания акта точно сломан в проде под JupyterHub. Fix: `${endpoint}?force_new_part=true` (endpoint уже полный URL) вместо `AppConfig.api.getUrl(\`${endpoint}?force_new_part=true\`)`.
2. **[HIGH] Orphan PATCH `/chat/conversations/{cid}`** — фронт не использует, UI кнопки переименования чата нет; либо подключить, либо выпилить с бэка.
3. **[HIGH] `/api/v1/admin/diagnostics` и `/api/v1/admin/audit-log` не подключены** в админ-панели — ценная функциональность написана и неиспользуется. Подключить.
4. **[HIGH] `/api/v1/system/version` не отображается в UI** — невозможно понять, какая версия задеплоена и работает (особенно после rollback). Добавить в `topbar.html` через meta-tag + AppConfig.
5. **[MEDIUM] Response shape для list-endpoints несогласован** — где-то `{items, total}`, где-то голый `list`. Договориться + мигрировать. Затронуты `chat/conversations`, `chat/messages`, `ck-*/records/search`.
6. **[MEDIUM] Error envelope несогласован** — FastAPI default `{detail}`, домен — гибкий dict, Kerberos — спец-структура. Ввести `{detail, code, ...}` envelope. Фронт перейдёт на `code`-switch.
7. **[MEDIUM] Pagination limits разные** — 200/500/2000 без системы. Унифицировать default-limit и max-limit.
8. **[MEDIUM] `/api/v1/acts/{act_id}/invoices` orphan** — проверить, использовалось ли ранее, если нужно — подключить в preview/export; если нет — выпилить.
9. **[LOW] `/api/v1/auth/validate` orphan, дублирует `/auth/me`** — выпилить или явно документировать use-case (внешний consumer).
10. **[LOW] `acts/{id}/audit-point-ids` без `MAX_BATCH_SIZE`** — добавить лимит на размер списка node_ids (защита от случайной отправки большого payload).

---

**Резюме счётчиков:**
- **Endpoints всего:** 53 (shared 9 + acts 24 + admin 7 + chat 11 + ck_client_exp 6 + ck_fin_res 6).
- **Orphan endpoints (не вызываются с фронта):** 11 (~21%) — из них 5 кандидатов «подключить в UI», 6 «оставить для внешнего/служебного».
- **Orphan frontend calls (URL без endpoint, 404 в проде):** 0 (все URL'ы матчатся с endpoints), но 1 BUG двойного `getUrl()` в `dialog-create-act.js:1378`.
- **Schema mismatches (статический анализ):** 0 явных, риск drift'а везде где нет contract-тестов.
