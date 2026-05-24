# NEW-4: Admin + CK + Error handling — фронт-аудит

> Скоуп: `app/domains/admin/`, `app/domains/ck_*/`, `templates/portal/admin|ck/**`, `static/js/portal/{admin,ck-*}/**`, `static/js/shared/ck/**`, плюс глобальный обзор error-handling в `static/js/` (всего ~39 файлов с try/catch, 163 try-блока, 129 catch).
> Дата: 2026-05-24. Снапшот веток `master`.

---

## ЧАСТЬ 1. Admin-страница

### §1.1 Inventory

#### Backend

| Файл | Строк | Роль |
|------|-------|------|
| `app/domains/admin/routes/portal.py` | 35 | HTML-роут `GET /admin` (только установка `is_admin=True`, без серверного `require_admin` gate — авторизация фронтом). |
| `app/domains/admin/api/roles.py` | 124 | REST API: `/roles`, `/users/directory`, `/users/search`, `/users/{u}/roles` GET/POST/DELETE, `/audit-log`. Все эндпоинты с `dependencies=[_admin]` (`require_admin()`). |

#### Templates

| Файл | Строк | Роль |
|------|-------|------|
| `templates/portal/admin/admin.html` | 66 | Шаблон страницы. Toolbar (+Add User), поиск, фильтр по ролям, заголовки сортируемой таблицы, контейнер таблицы. Все JS-точки монтажа `id="adminXxx"`. |

#### JS (4 файла, 654 строки)

| Файл | Строк | Роль |
|------|-------|------|
| `static/js/portal/admin/admin-page.js` | 52 | Контроллер. `init()` — `Promise.all([loadUserDirectory, loadAllRoles])`; биндинг кнопки add-user. |
| `static/js/portal/admin/admin-roles.js` | 348 | Таблица ролей: рендер, фильтры (text/role), сортировка по столбцам, toggle ролей через чипсы (оптимистичный UI с откатом). |
| `static/js/portal/admin/admin-add-user-dialog.js` | 220 | Диалог поиска по справочнику + выбор роли + assign. Наследует `DialogBase`. Debounce 300 мс. |
| `static/js/portal/admin/admin-search.js` | 34 | Дебаунс-обёртка (250 мс) над `AdminRoles.filterByText`. |

#### CSS (4 файла, 364 строки)

| Файл | Строк |
|------|------|
| `static/css/portal/admin/admin-page.css` | 39 |
| `static/css/portal/admin/admin-roles.css` | 192 |
| `static/css/portal/admin/admin-add-user.css` | 103 |
| `static/css/portal/admin/admin-search.css` | 30 |

### §1.2 Функции

`AdminPage.init/updateUserRoles/_initAddUserButton`
`AdminRoles.init/setUsers/filterByText/filterByRole/sort/addUser`, плюс приватные `_renderRoleFilters`, `_updateRoleFilterChips`, `_sortUsers`, `_renderAll`, `_applyFilters`, `_matchesTextFilter`, `_matchesRoleFilter`, `_renderRow`, `_toggleRole`, `_escapeHtml`, `_escapeAttr`.
`AdminAddUserDialog.show/_createDialog/_bindEvents/_onSearchInput/_selectUser/_onConfirm/_close`.
`AdminSearch.init/_onInput`.

### §1.3 API endpoints

| Endpoint | Method | Backend role | Called from |
|----------|--------|--------------|-------------|
| `/api/v1/admin/roles` | GET | `require_admin()` | `APIClient.loadAllRoles` → `AdminPage.init` |
| `/api/v1/admin/users/directory` | GET | `require_admin()` | `APIClient.loadUserDirectory` → `AdminPage.init` |
| `/api/v1/admin/users/search?q=` | GET | `require_admin()` | `APIClient.searchUsers` → `AdminAddUserDialog._onSearchInput` |
| `/api/v1/admin/users/{u}/roles` | GET | `require_admin()` | НЕ ВЫЗЫВАЕТСЯ фронтом (есть `directory` со всеми ролями сразу) |
| `/api/v1/admin/users/{u}/roles` | POST | `require_admin()` | `APIClient.assignRole` → `AdminRoles._toggleRole`, `AdminAddUserDialog._onConfirm` |
| `/api/v1/admin/users/{u}/roles/{rid}` | DELETE | `require_admin()` | `APIClient.removeRole` → `AdminRoles._toggleRole` |
| `/api/v1/admin/audit-log` | GET | `require_admin()` | **НЕ ВЫЗЫВАЕТСЯ фронтом** (UI для аудит-лога админа отсутствует). |

Все вызовы через `AppConfig.api.getUrl(...)` — JupyterHub-proxy совместимо. Везде шапка `X-JupyterHub-User`.

### §1.4 Role-checks

- **Бэк**: `defence-in-depth` — `require_admin()` И на уровне `include_router` через `domain_registry`, И на каждом эндпоинте через `dependencies=[_admin]`.
- **HTML-роут `/admin`**: `is_admin=True` ставится статически в контексте шаблона; реальная проверка делегирована фронту. Никакого `require_admin` на сам `GET /admin` — некий пользователь без роли увидит пустую страницу с 403 на api-вызовах.
- **Фронт**: `AdminPage.init()` ловит ошибку `loadAllRoles/loadUserDirectory` (если 403 — общее «Не удалось загрузить данные администрирования»). Нет специальной обработки 403 (не редирект, не «у вас нет прав»).

### §1.5 Флаги admin

| # | Severity | Code | Bad outcome | Effort | Fix |
|---|----------|------|-------------|--------|-----|
| A1 | **HIGH** | `portal.py:15-34` | `GET /admin` отдаёт страницу любому залогиненному (даже не-админу). API вернёт 403, но пользователь видит «битый» UI с уведомлением «Не удалось загрузить данные администрирования», без подсказки «у вас нет прав». | S | Добавить `Depends(require_admin())` на `show_admin_page` (как на API) или редирект на `/portal/acts` для не-админов с показом Notifications.warning. |
| A2 | MED | `admin-page.js:23-26` | Любая ошибка инициализации (timeout, 500, 403) даёт одно общее сообщение «Не удалось загрузить данные администрирования». Юзер не понимает: нет прав / упал сервер / нет сети. | S | Разветвить по `error.status`: 403 → «У вас нет прав администратора», 5xx → «Сервер недоступен», network → «Проверьте соединение». |
| A3 | MED | `admin-roles.js:274-306` | Оптимистичное обновление UI откатывается при ошибке, но `_users` массив **не обновляется** при отказе (если 500 пришёл уже после успешного INSERT в БД до commit — UI и БД рассинхронятся). Нет `_refreshUser(username)` для верификации. | M | После catch вызывать `AdminPage.refresh()` или fetch `/users/{u}/roles` (эндпоинт уже есть, не используется) для синхронизации. |
| A4 | LOW | `admin-add-user-dialog.js:111` | `APIClient.searchUsers` без отдельного debounce-cancel при closure диалога — если юзер закрыл диалог во время запроса, `resultsEl` уже отсоединён, но обработчик пишет в него (`resultsEl.innerHTML = ...`). Не падает, но потенциальная гонка. | S | Сохранять `AbortController` и `.abort()` в `_close()`. |
| A5 | LOW | `admin-add-user-dialog.js:134-137` | При ошибке поиска сообщение «Ошибка поиска» в результатах без `Notifications.error` — юзер может не заметить, особенно если результаты были редкие. | S | Добавить `Notifications.error('Не удалось выполнить поиск пользователей')`. |
| A6 | LOW | `admin-roles.js:241-266` | `_renderRow` использует `innerHTML` с `_escapeHtml`/`_escapeAttr`, но **chip.title** в `_renderRoleFilters` ставится напрямую через `chip.title = role.description`, без экранирования. Не уязвимо (title-атрибут не парсится как HTML), но XSS-stub-чёрный в строгом ревью. | S | Унификация: всегда textContent/setAttribute. |
| A7 | LOW | `admin.html:48-53` | 4 `<script>` подключаются обычными `<script src=...>` без `defer`/`async`; порядок критичен (search → roles → add-user-dialog → page), но не задокументирован в шаблоне. CLAUDE.md явно предупреждает о таких рисках для constructor (~50 файлов). | S | Комментарий в HTML или `defer` + DOMContentLoaded явный. |
| A8 | INFO | `roles.py:102-123` + JS | `/api/v1/admin/audit-log` существует на бэке, но фронт никак его не использует — нет UI журнала операций администратора. Параллельный аудит-лог актов есть в `acts-manager/dialog-audit-log.js`. Либо мёртвый endpoint, либо TODO-фича. | M | Решить: добавить UI (вкладку «Журнал» в admin.html) или удалить endpoint. |

---

## ЧАСТЬ 2. CK страницы (ck-client-exp + ck-fin-res)

### §2.1 Inventory CK Client Experience

#### Backend

| Файл | Строк | Роль |
|------|-------|------|
| `app/domains/ck_client_exp/routes/portal.py` | 29 | HTML-роут `GET /ck-client-experience`. |
| `app/domains/ck_client_exp/api/records.py` | 95 | CRUD: `POST /records/search`, `GET /records/{id}`, `POST /records`, `POST /records/batch-update`, `DELETE /records/{id}`. Все с `require_domain_access("ck_client_exp")`. |
| `app/domains/ck_client_exp/api/dictionaries.py` | 33 | `GET /dictionaries/{name}` — 7 справочников (`processes, terbanks, metrics, departments, channels, products, teams`). |

#### JS

| Файл | Строк |
|------|------|
| `static/js/portal/ck-client-exp/ck-client-exp-page.js` | 186 |
| `static/js/portal/ck-client-exp/ck-client-exp-config.js` | 71 |

### §2.2 Inventory CK Fin Res

| Файл | Строк | Роль |
|------|-------|------|
| `app/domains/ck_fin_res/routes/portal.py` | 29 | `GET /ck-fin-res`. |
| `app/domains/ck_fin_res/api/records.py` | 95 | Тот же CRUD что и `ck_client_exp` — диффом отличаются только имена сервисов и `domain_access("ck_fin_res")`. |
| `app/domains/ck_fin_res/api/dictionaries.py` | 34 | + `risk_types` (специфично для FR). |
| `static/js/portal/ck-fin-res/ck-fin-res-page.js` | 200 |
| `static/js/portal/ck-fin-res/ck-fin-res-config.js` | 103 |

### §2.3 Templates

| Файл | Строк |
|------|------|
| `templates/portal/ck/ck_client_experience.html` | 71 |
| `templates/portal/ck/ck_fin_res.html` | 71 |

### §2.4 Shared CK-компоненты (`static/js/shared/ck/`)

| Файл | Строк | Использование |
|------|-------|---------------|
| `ck-table.js` | 223 | Таблица записей, сортировка, фильтр, локальная пагинация. Использует обе страницы. |
| `ck-pagination.js` | 121 | Компонент пагинации (1-7 страниц + prev/next). Inline-стили через `btn.style.*` — не CSS-классы. |
| `ck-form.js` | 466 | Декларативная форма по конфигу: text/number/date/textarea/checkbox/dictionary/select/process-picker/readonly-text. Маска КМ, regex-валидаторы, paired-fields, paired_extras. |
| `ck-process-picker.js` | 172 | Popup-диалог выбора процесса с поиском. Наследует `DialogBase`. |

#### CSS (`static/css/portal/ck/`, 450 строк)

`ck-form.css` (120), `ck-page.css` (151), `ck-process-picker.css` (87), `ck-table.css` (92).

### §2.5 L2 verification — насколько похожи CE и FR

**Templates:** `diff ck_client_experience.html ck_fin_res.html` — отличаются 4 строки:
- title-блок,
- комментарий `<!-- CS-specific -->` vs `<!-- FR-specific -->`,
- пути к 2 config/page js,
- имя класса в init (`CkClientExpPage.init` vs `CkFinResPage.init`).

**Backend portal.py:** идентичны кроме URL/имени шаблона/`active_page`/`topbar_title`/`domain_name` в `get_chat_domains_for_page`.

**Backend api/records.py:** идентичны кроме имени домена в `require_domain_access`, имени схем (`CSValidationCreate` vs `FRValidationCreate`), имени сервиса (`CSValidationService` vs `FRValidationService`), logger name и docstring.

**Frontend page.js:** идентичная логика, отличается только именами классов (`CkClientExpPage` vs `CkFinResPage`, `CkClientExpConfig` vs `CkFinResConfig`) и форматированием (FR-страница имеет `if (xxx) { ... }` вместо однострочников, и комментарии-разделители «// Таблица», «// Поиск» — лишний шум). **Логически — 100% дубликат.**

**Frontend config.js:** `formatDate/formatNumber/formatTerbank` идентичны байт-в-байт (только через `XxxConfig.method` self-reference внутри). `columns` идентичны. Различаются ТОЛЬКО:
- `apiPrefix`, `domainName`, `pageTitle`,
- `fields` — у FR на 12 полей больше (revision dates, reason/consequence, sberdocs/assigment, used_pm, risk и т.п.),
- `dictNames` — у FR +`risk_types`,
- FR имеет 2 hardcoded option-списка.

**Подтверждение L2:** ✅ практически полное дублирование инфраструктуры. Реальный delta — только `fields[]` конфиг + 1 справочник. Можно вынести в один `CkPage` класс, принимающий config-объект.

### §2.6 API endpoints CK

| Endpoint | Method | Backend role | Called from |
|----------|--------|--------------|-------------|
| `/api/v1/ck-client-exp/records/search` | POST | `require_domain_access("ck_client_exp")` | `APIClient.searchCkRecords(prefix='ck-client-exp')` → `_loadData` |
| `/api/v1/ck-client-exp/records/{id}` | GET | same | `APIClient.getCkRecord` (определён, но фронтом НЕ вызывается — данные уже в `_records` после `_loadData`) |
| `/api/v1/ck-client-exp/records` | POST | same | `createCkRecord` → `_onSave` (create-mode) |
| `/api/v1/ck-client-exp/records/batch-update` | POST | same | `updateCkRecords` → `_onSave` (edit-mode, шлёт массив из 1 элемента) |
| `/api/v1/ck-client-exp/records/{id}` | DELETE | same | `deleteCkRecord` → `_onDelete` |
| `/api/v1/ck-client-exp/dictionaries/{name}` | GET | same | `getCkDictionary` → `_loadDictionaries` (Promise.all по `dictNames`) |
| `/api/v1/ck-fin-res/*` | — | `require_domain_access("ck_fin_res")` | те же 6 методов с `prefix='ck-fin-res'` |

Все через `AppConfig.api.getUrl()` — JupyterHub-совместимо.

### §2.7 CRUD operations: auth + role checks

- **Auth**: каждый fetch шлёт `X-JupyterHub-User`. На бэке `_access = Depends(require_domain_access("ck_*"))`.
- **`require_domain_access`** (`app/api/v1/deps/role_deps.py`) — админ имеет доступ ко всем доменам; иначе проверяется наличие роли с привязкой к домену. Cache TTL=5 сек (см. CLAUDE.md).
- **Soft delete**: DELETE → 204, бэк делает мягкое удаление через `service.delete_record(id, username)`. Frontend `_onDelete` показывает `DialogManager.show({type:'warning'})` — confirm-диалог обязателен.
- **Batch limit**: 500 записей за один `batch-update`; фронт сейчас всегда шлёт массив из 1 элемента (используется как «update single by id»), MAX_BATCH_SIZE избыточен.

### §2.8 Флаги CK

| # | Severity | Code | Bad outcome | Effort | Fix |
|---|----------|------|-------------|--------|-----|
| C1 | **HIGH** | `ck-client-exp-page.js` ↔ `ck-fin-res-page.js` (386 строк дублирования) | Любой баг или фикс надо вносить параллельно в 2 файла. Уже наблюдается дрифт — в FR-версии добавлены формальные `{}` и комментарии-разделители, отсутствующие в CE. Со временем разойдутся семантически. | M | Вынести `CkPage` базовый класс в `static/js/shared/ck/ck-page.js`, принимать `config` в `init(config)`. На страницах оставить `CkPage.init(CkClientExpConfig)`. |
| C2 | MED | `ck-client-exp/ck-fin-res-page.js:74-82` | `_loadData` грузит ВСЕ записи без пагинации (`searchCkRecords({})` без `limit`/`offset`), затем кладёт в `_records` и в локальный `CkTable.setData`. При росте таблицы — лаг и память. Серверная пагинация в `records.py` есть (`ValidationSearchRequest` имеет `limit`/`offset`), но не используется фронтом. | M | Включить серверную пагинацию в `CkPagination` (отправлять offset в search). |
| C3 | MED | `_loadData → _loadDictionaries` оба `Promise.all` без `AbortController` | Если пользователь быстро переключился между CE и FR — параллельные запросы конкурируют. Поскольку страницы — отдельные навигации (full reload), низкоприоритетно. | L | Добавить cancel в _loadDictionaries при unmount (но full reload снимает проблему). |
| C4 | MED | `ck-form.js:64-65` | `el.value.trim() === '' ? 0 : Number(val)` — для опциональных number-полей пустое значение трактуется как `0`. На бэке `Optional[int]` ждёт `null`. Пользователь, очистивший поле, не «снимает» значение, а ставит 0. | S | Менять на `val === '' ? null : Number(val)` или явная опция `field.allowNull`. |
| C5 | MED | `ck-form.js:357-369` | Если значение справочника **удалено** (legacy), форма подкладывает «голый» strVal как option. Но при save этот невалидный код уйдёт в БД. Никакой подсветки «значение устарело». | S | Добавить визуальный маркер для legacy-option (`opt.classList.add('ck-form__option--legacy')` + label «(удалено)`). |
| C6 | MED | `ck-table.js:111-114` | Empty-state «Нет записей» показывается одинаково при «реально пусто» и при «filter не дал результата». Юзер не понимает, нужно ли сбрасывать фильтр. | S | Если `_filterQuery` пуст → «Нет записей», иначе → «По фильтру ничего не найдено — [Сбросить]». |
| C7 | LOW | `ck-pagination.js:76` | Лимит `7 страниц` в навигации зашит магическим числом. При >7 страницах нет «...» и не показываются последние номера. | S | Реализовать стандартный pagination pattern (1 2 3 ... 9 10). |
| C8 | LOW | `ck-pagination.js:54-117` | Все стили inline через `btn.style.*`. Не CSS — нельзя темизировать, нельзя hover-эффект через :hover. | M | Перенести в `ck-page.css`. |
| C9 | LOW | `ck-form.js:411-432` (`_attachKmMask`) | Маска КМ дублирует логику из `static/js/portal/acts-manager/...` (`acts-manager` упоминается в комментарии). Нет общего KmMask-утилиты. | M | Вынести в `static/js/shared/km-mask.js`. |
| C10 | LOW | `ck-fin-res-config.js:7-14` | `FR_ASSIGNMENT_FORMAT_OPTIONS`, `FR_USED_PM_OPTIONS` — глобальные `const` в module-scope, без `window.X = ...`. В vanilla-JS без бандлера это work-by-accident: `<script>` создаёт глобальный scope, но CLAUDE.md явно предупреждает («`const X = new ...` в `<script>` не становится свойством `window`»). Сейчас работает, потому что используются только внутри того же файла. | S | Либо переместить как static в класс, либо `window.FR_*` для консистентности. |
| C11 | LOW | `ck-form.js:51-84` | `collectData` использует `document.getElementById(...)` напрямую — если в шаблоне был добавлен другой элемент с таким же id (`ck-field-X`), коллизия. Привязка не через `containerEl.querySelector`. | S | `this._config.containerEl.querySelector(...)`. |
| C12 | INFO | `ck_client_experience.html:38-39` + `ck_fin_res.html:38-39` | Inline стили на кнопках Save/Delete (`style="padding:5px 20px; ..."`). Должно быть в CSS. | S | Перенести в классы btn-sm/btn-danger. |
| C13 | INFO | `dictionaries.py: Literal[...]` | `processes, terbanks, metrics, departments, channels, products, teams` — у CE определены все 7, но `dictNames` фронта объявляет только `['metrics', 'terbanks', 'processes']`. Лишние эндпоинты есть, но фронт их не дёргает. У FR — `+risk_types`. | INFO | Удалить неиспользуемые элементы Literal либо подключить на фронте если ожидается. |
| C14 | INFO | `ck-form.js:30-35` `clear()` vs `renderEmpty()` | Семантика confusing: `clear()` = create-mode, `renderEmpty()` = empty-mode. Имена не передают это. | S | Переименовать в `setCreateMode()` / `setEmptyMode()`. |

---

## ЧАСТЬ 3. Error handling — глобальный аудит

### §A. Карта try/catch — статистика

- **Файлов с `try {`:** 39
- **Total `try` блоков:** 163
- **Total `catch (`:** 129  (разница — finally-only блоки + повторно вложенные)
- **Полностью пустые catch (`catch (e) {}`):** **1** — `chat-client-actions.js:114` (`catch (_) {}` для `sessionStorage.removeItem` — приемлемо, sessionStorage может быть disabled).
- **`.catch(() => {})`-форма (silent):** **3**
  - `chat-renderer.js:854` — `.catch(() => { pre.textContent = 'Ошибка загрузки файла'; })` (показывает текст ошибки — OK).
  - `chat-renderer.js:969` — без user-facing уведомления.
  - `version-preview.js:305` — `APIClient.unlockAct(this._actId).catch(() => {})` — **silent fail!** Если разблокировка упала после превью — акт может остаться залочен.

Распределение catch по доменам:
- `constructor/**`: ~85
- `shared/chat/**`: ~30
- `portal/admin/**`: 4
- `portal/ck-*/**`: 8
- `portal/acts-manager/**`: ~30
- `shared/api.js`: 9

#### Топ-паттерны catch

1. **`console.error(...)` + `Notifications.error(...)`** — best-practice, есть в admin/CK/acts-manager.
2. **`console.error(...)` + return null/false** — silent fail с логом (см. §H).
3. **`console.error(...)` + throw err** — пробрасывание (api.js, navigation-manager.js) — OK.
4. **`console.error(...)` без notify** — silent в продакшен-консоли (см. §H топ-10).
5. **`console.warn(...)` без notify** — приемлемо для не-критичных операций.

### §B. Notifications usage

`Notifications` экспонирует `success/error/info/warning` (notifications.js:340-377), 4 уровня.

**Распределение использования (по grep `Notifications\.(error|success|warning|info)`):**

| Метод | Total calls | Top consumers |
|-------|-------------|---------------|
| `Notifications.error` | ~106 | acts-manager-page (14), context-menu-cells (22 из всех), dialog-invoice (7), table-cells-operations (16), context-menu-tree (17) |
| `Notifications.success` | ~50 | acts-manager-page, ck-*-page, admin-add-user-dialog, dialog-create-act (12) |
| `Notifications.warning` | ~15 | storage-manager, lock-manager (read-only mode) |
| `Notifications.info` | ~16 | acts-manager-page, dialog-create-act, api.js (generation results) |

Всего 187 вызовов в 31 файле. CK/admin зоны — ~10% от объёма; основная масса — constructor.

### §C. Loading states

**Единого spinner-компонента НЕТ.** `Grep -i spinner|loader|loading-overlay` в js: 1 (api.js — упоминание readOnly). В CSS — 3 файла (acts-manager-base.css, acts-menu.css, variables.css), но это не общий компонент.

Что есть как loading-state:

| Операция | Loader? | Где |
|----------|---------|-----|
| Admin `AdminPage.init` | НЕТ | таблица просто пуста до окончания загрузки |
| Admin search в диалоге | ✅ `<div class="admin-add-loading">Поиск...</div>` | `admin-add-user-dialog.js:110` |
| CK `_loadData/_loadDictionaries` | НЕТ | таблица пустая до загрузки, форма «Выберите запись» |
| CK form save/delete | НЕТ | кнопка не disable’ится, нет «Сохранение..." |
| Constructor `generateAct` | НЕТ | (только Notifications.info по окончании) |
| Acts-manager list load | ✅ есть `_showErrorState` (`acts-manager-page.js:237`), но нет `_showLoadingState` |
| Chat send | ✅ через `chat-messages.js` placeholder bubble |
| Audit-log dialog | ✅ `<div class="audit-log-loading">` |
| Versions list | ✅ `<div class="audit-log-loading">` |
| Version-preview diff | ✅ |
| Lock extend/auto-extend | НЕТ (фоновый) |

Дисбаланс: на 5+ операций нет loaders, а у каждого диалога свой `class="*-loading"` (нет единого `.app-spinner`).

### §D. Empty states

`Grep -i "Нет (данных|записей)|пуст|empty"` находит **34 файла** с empty-state логикой:
- `ck-table.js:112` — «Нет записей» (один вариант на «реально пусто» и «фильтр без матчей» — флаг C6).
- `ck-form.js:134` — «Выберите запись или создайте новую» (form empty).
- `ck-process-picker.js:86` — «Процессы не найдены».
- `admin-add-user-dialog.js:114` — «Пользователи не найдены».
- `acts-manager-page.js` — есть empty (полноценный baseline для портала).
- `dialog-audit-log.js` — «Аудит-лог пуст».

**Где empty state отсутствует:**
- `AdminRoles._renderAll` — при пустом `_users` рендерит пустую таблицу без сообщения «Нет пользователей в системе» (только заголовки).
- `AdminRoles._applyFilters` — после фильтра ВСЕ строки могут скрыться (`row.classList.toggle('hidden', ...)`), но нет сообщения «По фильтру ничего не найдено».

### §E. Error boundaries

**Глобальных error boundary НЕТ:**
- `Grep "window.onerror|unhandledrejection|window.addEventListener('error'"` → **0 матчей** во всём `static/js/`.
- Любая необработанная Promise rejection → silent в DevTools.
- Любая sync-ошибка (`TypeError`, `ReferenceError` в `addEventListener` handler) → silent (browser console only).
- Нет sentry/телеметрии.

**Что нужно добавить:**
```js
// shared/error-boundary.js
window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.error || e.message, e.filename, e.lineno);
    if (typeof Notifications !== 'undefined') {
        Notifications.error('Произошла непредвиденная ошибка. Обновите страницу.');
    }
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[UnhandledPromise]', e.reason);
});
```

### §F. Network error handling (APIClient)

**Что есть:**
- `_throwApiError(response)` — парсит JSON `.detail`, безопасно (try/catch) обрабатывает не-JSON ответ (HTML error page → fallback).
- `_createError(status, detail)` — Error с `error.status`.
- Differential 403/404 handling в `loadActContent`, `saveActContent`, `deleteAct` (status-specific messages).

**Что отсутствует:**
- **Timeout НЕТ.** `grep AbortController` в `api.js` → 0. Если бэк зависнет на 30 секунд — fetch висит до браузерного default (минуты).
- **Retry НЕТ.** Любой 5xx сразу падает (на бэке есть LLM retry, но не для API ↔ frontend).
- **Offline-режим НЕ ДЕТЕКТИРУЕТСЯ.** `navigator.onLine`, `window.addEventListener('offline'/'online')` не используется.
- **CORS / network errors** — `fetch()` throws TypeError при network failure, попадает в `catch`, но сообщение «Failed to fetch» нелокализовано.
- **5xx vs 4xx** — единый поток `_throwApiError`, без шанса на retry для 503.

### §G. Validation error handling

- **4xx с body**: `_throwApiError` парсит `body.detail` — отображается через `Notifications.error('Ошибка: ${err.message}')`.
- **422 (pydantic validation)**: FastAPI шлёт `{"detail": [{"loc":..., "msg":..., "type":...}]}`. `body.detail` будет массивом → отобразится как `[object Object]`. **Это баг.** Реальный пример: при `metric_amount_rubles=-5` юзер увидит `Ошибка: [object Object]`.
- **Inline-validation**: `ck-form.js` использует `setCustomValidity` + `reportValidity` (КМ-маска, regex) — браузерный popup. Корректно.
- **Required-field validation**: `CkForm.validate()` подсвечивает поля красным (`ck-form__input--error`) и шлёт `Notifications.error('Заполните обязательные поля: A, B')`. OK.

### §H. Топ-10 silent fails которые точно стоит исправить

| # | Severity | File:line | Что | Impact | Fix |
|---|----------|-----------|-----|--------|-----|
| H1 | **CRIT** | `version-preview.js:305` | `APIClient.unlockAct(this._actId).catch(() => {})` — silent при разблокировке после preview. | Акт может остаться залочен на пользователе после закрытия preview. Другие пользователи получат «занят». | `.catch(err => { console.error(...); Notifications.warning('Не удалось снять блокировку, она снимется автоматически через час'); })` |
| H2 | **HIGH** | `api.js:472-475` `_saveDefaultStructure` | `catch (err) { console.error(...); /* не бросаем */ }` | Если дефолтная структура нового акта не сохранилась — пользователь думает «сохранено», но при перезагрузке акт пустой. | Бросать наверх + `Notifications.warning('Не удалось сохранить начальную структуру акта')`. |
| H3 | **HIGH** | глобально | Нет `window.onerror` / `unhandledrejection` | Любая необработанная ошибка JS → silent → юзер в недоумении почему «кнопка не работает». | Добавить `shared/error-boundary.js` (см. §E). |
| H4 | **HIGH** | `api.js` повсюду | Нет fetch timeout / AbortController | Бэк/прокси повис → юзер ждёт минуты, не видит фидбека. | Wrapper `apiFetch(url, opts, timeout=30000)` через `AbortController`. |
| H5 | **HIGH** | `api.js` 4xx | 422-ответ FastAPI рендерится как `[object Object]` | Юзер не понимает, какое именно поле невалидно. | В `_throwApiError` если `body.detail` — массив, форматировать `detail.map(d => d.msg).join('; ')`. |
| H6 | MED | `admin-roles.js:299-305` | Rollback оптимистичного UI без вызова `Notifications` детально — только `error.message`. Если message пустой (network) — «Ошибка: ». | Юзер не понимает, удалось ли изменение. | Default message: `error.message || 'Не удалось обновить роль'`. |
| H7 | MED | `lock-manager.js:237`, `:251` `extendLock` | `catch ... return false` — silent return | Автопродление может тихо отвалиться, лок истечёт во время редактирования → юзер потеряет правки при попытке сохранить. | Хотя бы один `Notifications.warning` после N подряд failed extends. |
| H8 | MED | `dialog-invoice.js:182-184` | `console.error('Ошибка загрузки конфига фактур')` без `Notifications` | Диалог откроется с пустой структурой — юзер не понимает почему фактура не привязывается. | + `Notifications.error('Не удалось загрузить конфиг фактур, повторите попытку')`. |
| H9 | MED | `chat-stream.js:153-155` resume catch | `console.error('ChatStream: resume не удался')` без UI-маркера | Стрим прервался → юзер думает что чат «завис», шлёт ещё раз. | Показывать в bubble «Соединение прервано, нажмите для повтора». |
| H10 | MED | `dialog-invoice.js:1152-1153`, `:1171-1172` verify/save warn | `console.warn(...)` без UI | Save после attach фактуры может тихо упасть — юзер увидит фактуру в UI, но при перезагрузке её не будет. | `Notifications.warning('Изменения сохранятся при следующем save')`. |

---

## Сводная статистика

- **Admin зона**: 654 строк JS / 364 строк CSS / 66 строк HTML / 159 строк Python (routes+api). 6 API endpoints (1 неиспользуемый). 8 флагов.
- **CK зона**: 957 строк JS (страницы+shared) / 450 строк CSS / 142 строк HTML / 285 строк Python. 12 API endpoints. ~95% дублирование между CE и FR. 14 флагов.
- **Error handling**: 163 try / 129 catch / 1 пустой / 3 silent promise / 0 глобальных error boundaries / 0 fetch timeouts / 0 retry. 10 топ-fix'ов выделено.

**Главные приоритеты по проекту целиком:**
1. H3+H4: глобальный error boundary + fetch timeout.
2. H1+H2+H7: silent unlock/save/extend (corruption-риск).
3. H5: human-readable 422 errors.
4. C1: extract `CkPage` базовый класс (дублирование 386 строк).
5. A1: серверный gate на `GET /admin`.
