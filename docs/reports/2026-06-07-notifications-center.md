# Универсальный центр уведомлений — отчёт о реализации

Дата: 2026-06-07. Ветка: `notifications-center` (от `preview-ux-refinements`; PR в master — за владельцем).
Дизайн-спека (рабочий артефакт, gitignored): `docs/superpowers/specs/2026-06-07-notifications-center-design.md`.

## Что сделано

Единый центр уведомлений для всех страниц AuditWorkstation (портал + конструктор): персистентные уведомления (адресные конкретному пользователю **и** broadcast всем) со статусами прочитано/скрыто, плюс живые замечания по таблицам в том же колокольчике (конструктор). Источники: ручной push (API), события актов, ответ базы знаний (чат). Транспорт — polling (без SSE, по конвенции проекта).

Реализовано пятью задачами, каждая — своя под-ветка, влитая в `notifications-center`:

| Задача | Ветка | Суть |
|---|---|---|
| T1 | `notifications-domain-backend` | Бэкенд-домен `notifications`: таблицы PG+GP, repository, service, API, фабрика `notifications.push`; флаг `public_api` в `DomainDescriptor`. |
| T2 | `notifications-shared-bell` | Единый shared-колокольчик (портал + конструктор): движок `NotificationCenter` + чистое ядро, живой источник «tables», CSS, конвергенция (заменил bespoke-колокольчик конструктора). |
| T3 | `notifications-acts-producer` | Домен acts эмитит уведомления (создание/экспорт акта) через фабрику. |
| T4 | `notifications-chat-producer` | Домен chat эмитит уведомление о готовности/ошибке ответа базы знаний через фабрику. |
| T5 | `notifications-docs` | Доки + финальная верификация. |

## Ключевые решения

- **Две таблицы вместо fan-out.** `notifications` (одна запись, `recipient_user_id` NULL = broadcast) + `notification_state` (`(notification_id, user_id)` → `is_read`, `is_dismissed`). Это даёт адресные **и** broadcast уведомления с **персональной** прочитанностью, корректно охватывая будущих пользователей (state создаётся лениво). Fan-out по пользователям отвергнут (broadcast не дошёл бы до новых юзеров, раздувал бы таблицу).
- **`public_api` — общий механизм опт-аута доменного гейта.** `register_domains()` штатно вешает `require_domain_access(<домен>)` на роутеры каждого не-admin домена. Колокольчик общий для всех ролей, поэтому в `DomainDescriptor` добавлен флаг `public_api: bool=False`; при `True` гейт не вешается (остаётся только `get_username`). Домен `notifications` его выставляет. Это общий механизм, не хардкод имени. Регрессия: `tests/domains/notifications/test_notifications_api_e2e.py::test_public_api_skips_domain_gate` (монтаж через настоящий `register_domains`).
- **Кросс-доменные продьюсеры — через фабрику, мягко.** acts/chat эмитят уведомления через `has_factory("notifications.push")` + `get_factory`, **без прямого импорта** домена notifications. Вся эмиссия в `try/except` и **только после успеха** основной операции — сбой/отсутствие уведомления не ломает экспорт/финализацию ответа. `has_factory`-guard обеспечивает нулевую регрессию: в существующих тестах домен notifications не зарегистрирован → эмиссия пропускается.
- **GP-совместимость.** `VARCHAR(36)` id; `DISTRIBUTED BY (id)` для `notifications`, `DISTRIBUTED BY (notification_id)` ⊆ PK `(notification_id, user_id)` для state (co-location по id для join); без `ON CONFLICT` (upsert = UPDATE→INSERT), без `IF NOT EXISTS` у GP-индексов, без `gen_random_uuid`/`jsonb_set`. CHECK `check_notifications_severity` добавлен в `CHECK_CONSTRAINT_MESSAGES` (имя по фактической конвенции `check_<table>_<purpose>` без `{PREFIX}`, т.к. CI-линт извлекает имя регексом `\w+`).
- **Единый колокольчик, два вида источников.** `NotificationCenter` биндится к одним DOM-id на портале и в конструкторе. Персистентный источник встроен (polling ~30с, пауза при `document.hidden`, refresh по событию `notifications:refresh`/при открытии). Живые источники регистрируются через `registerSource` — в конструкторе это «tables» (обёртка `ValidationTable.collectContentWarnings()` + переход к таблице/подсветка, перенесено из прежнего bespoke-колокольчика). Чистые функции (`pickBadgeSeverity`/`computeBadge`/`mergeFeed`) вынесены в `notification-center-core.js` и покрыты node:test.
- **Навигация.** Персистентное уведомление с `link` → переход через `AppConfig.api.getUrl` (proxy-safe), `element_ref` — best-effort hash. Без `link` — без перехода (по требованию владельца). Живое — свой `onClick`.

## Что отложено (осознанно, вне первого скоупа)

- **Фоновая очистка по `retention_days`** — параметр заведён в `NotificationsSettings`, сам cleanup-хук не реализован.
- **Тонкая маршрутизация получателей событий актов.** В метаданных акта нет поля статуса (нет «на рассмотрении»), поэтому acts эмитит на инициатора действия (`recipient_user_id=username`) при создании/экспорте. Точку «смена статуса» добавить, когда появится статус-модель.
- **Deep-link в чат.** Чат — popup без собственного URL; уведомление об ответе БЗ идёт с `link=None`. Когда в контексте вопроса появится надёжный `act_id` — можно проставлять переход к акту.
- **Авторизация ручного push.** Любой авторизованный может создать уведомление (в т.ч. адресное/broadcast); более тонкая авторизация — отдельным решением при необходимости.

## Верификация

- pytest (полный): **1627 passed, 0 failed** (включая 27 тестов домена notifications, 6 продьюсера acts, 5 продьюсера chat, GP-совместимость и маппинг CHECK).
- node:test: **176 passed, 0 failed** (включая 17 для чистого ядра колокольчика).
- Каждая задача прошла adversarial-ревью; критический дефект доменного гейта (общий API за `require_domain_access`) выявлен ревью и закрыт флагом `public_api` + регрессионным тестом.
- **Не проверено вживую под браузером** (нет запущенного приложения/БД в сессии): DOM-поведение колокольчика (поллинг, dismiss/read, навигация, позиция бейджа в topbar портала vs шапке конструктора) требует визуальной проверки. Бэкенд-эндпоинты должны быть задеплоены, иначе персистентный источник тихо отдаёт пустой снимок (колокольчик не ломается, но персистентных уведомлений не показывает).

## Как расширять

- **Новый источник-продьюсер (бэкенд):** из любого домена — `has_factory("notifications.push")` → `get_factory(...)` → `async for svc in factory(): await svc.push(source=..., title=..., link=..., recipient_user_id=...)`, в `try/except`, после успеха операции. Не импортировать домен notifications напрямую.
- **Новый живой источник (фронт, client-side):** `notificationCenter.registerSource(key, { collect: async () => items })`, где item = `{id, title, body, severity, onClick}`; дёргать `center.refresh()` или диспатчить `notifications:refresh` при изменении.
- **Общий API без доменного гейта:** выставить `public_api=True` в `DomainDescriptor`.
