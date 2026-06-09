# Предмёрджевая проверка ветки `notifications-center` и точечный рефакторинг (2026-06-08)

Ветка: `notifications-center` (75 линейных коммитов над `master`, 145 файлов, +11k/−1.5k).
PR в master делает владелец. Цель отчёта — зафиксировать, что ветка проверена на
корректность («все ли баги закрыты, ничего ли не упущено») и приведена в порядок
перед слиянием.

## Что проверялось

Бэйзлайн (до правок): **pytest 1629 passed** (`-p no:randomly`), **node:test 188 passed**.

Ветка состоит из трёх крупных тем, каждая прошла отдельный обзор с проверкой
находок по коду (read + grep call-sites — без доверия «на слово», по правилу
«доверяй тест-агентам с проверкой»):

1. **Центр уведомлений (бэкенд-домен)** — `app/domains/notifications/*`, гейт
   `public_api`, фабрика `notifications.push`, миграции PG/GP, `.env.example`,
   `CHECK_CONSTRAINT_MESSAGES`.
2. **Продьюсеры уведомлений и кросс-доменная интеграция** — acts
   (`notifications_producer.py`, `act_crud_service`, `export`), chat
   (`agent_channel._emit_answer_notification`).
3. **Фронт центра уведомлений** — `shared/notifications-center/*`, живые источники
   (tables/acts), кнопки шапки, прокси-URL, XSS, поллинг-конфиг, teardown-guard.
4. **Таблицы (фронт-рефактор)** — range-list объединений, целочисленные colWidths,
   pinned-инварианты, дискриминатор подвида, извлечённые pure-ядра.
5. **Таблицы (бэкенд)** — серверная 422-валидация структуры, DOCX/TXT/MD,
   репозитории, схемы PG/GP, XSS-инвариант, updated_at.
6. **Предпросмотр** — единый рендер inline+модалка, fit-to-width, общий класс
   `.preview-sheet`, печать.

### Проверенные load-bearing правила (все соблюдены)

- GP 9.4: схемы домена уведомлений без `ON CONFLICT`/`IF NOT EXISTS`-индексов в
  GP/`jsonb_set`/`gen_random_uuid`; ленивый upsert состояния = UPDATE→INSERT.
- `DISTRIBUTED BY` ⊆ PK: `notifications (id)`; `notification_state
  (notification_id, user_id)` distributed by `notification_id`; новый
  `UNIQUE(act_id, node_id)` в acts — `act_id` входит в распределение. UUID = `VARCHAR(36)`.
- Плейсхолдеры `{SCHEMA}.{PREFIX}`, имена индексов `idx_{PREFIX}*` — в обеих схемах.
- `check_notifications_severity` замаплен в `CHECK_CONSTRAINT_MESSAGES`.
- `NOTIFICATIONS__*` в `.env.example`.
- Продьюсеры эмитят через `has_factory`/`get_factory` (без импорта домена), в
  `try/except`, **после** успеха основной операции и **вне** её транзакции —
  сбой уведомления не откатывает акт/экспорт/финализацию ответа.
- Доменные исключения — наследники `AppError`, не `fastapi.HTTPException`.
- `public_api=True` отключает доменный гейт обобщённо (без хардкода имени домена).
- Все `fetch`/навигация во фронте центра — через `AppConfig.api.getUrl(...)`
  (прокси-safe); заголовки/тело рендерятся `textContent` (XSS-safe);
  orphan-timer закрыт флагом `_destroyed`.
- `mark_all_read`: `$1::varchar` (исправленный ранее `AmbiguousParameterError`) —
  единственное место с параметром в SELECT-списке, каст корректен.

## Найдено и исправлено

Дефектов уровня BUG не выявлено. Исправлены реальные, но мелкие дефекты:

- **Мёртвый код (RISK).** `reconcileAfterMove` и экспортируемая
  `findFirstLevelAncestorUnder5` в `state/metrics-risk-core.js` — ноль вызовов по
  репозиторию (живой путь перемещения реализован отдельными методами
  `AppState._reconcileMetricsTablesAfterMove` / `_findFirstLevelAncestorUnder5` в
  `state-tree.js`). Это дивергентный дубль живой логики, оставшийся от
  «removed dead code»-коммита. Удалены (хелпер `is5xNode` остаётся живым — другие
  вызовы). Ссылок в `docs/`/тестах нет.
- **Осиротевший импорт (NIT).** `import { ContextMenuManager }` в
  `state/metrics-risk-coordinator.js` — не использовался (живой потребитель на
  master обращался к `window.ContextMenuManager`, а удалённый в этой ветке
  `validateAddRiskTable` — единственный). Удалён.
- **Клиент строже сервера (RISK, нарушение правила f16877e).** Клиентская
  `hasStructuralDefect` (`validation/validation-table-core.js`) красила красным
  таблицу с пустым `colWidths: []`, тогда как сервер пустой `colWidths`
  **допускает** (`if self.colWidths and ...`, есть `test_empty_widths_allowed`;
  `insert_table(col_widths=[])` даёт ровно такой случай). Докстринг функции при
  этом утверждал «зеркалит серверную TableSchema». Добавлено `colWidths.length > 0`
  + регрессионный JS-тест. Замечание было нефатальным (только покраска панели,
  не блок сохранения/422), но прямо противоречило правилу «клиент не строже сервера».
- **500 на user-reachable эндпоинте (NIT-hardening).** `POST /api/v1/notifications`
  (доступен любому аутентифицированному, гейт домена выключен) принимал
  `NotificationCreate` без ограничений длины → переполнение колонки уходило
  `StringDataRightTruncationError` (нет хендлера) → сырой 500. Добавлены
  `max_length` по ширине колонок (`source` 100, `title` 300, `link` 1000,
  `element_ref` 200, `recipient_user_id` 50) и `severity: Literal[...]` (тот же
  набор, что у CHECK) — переполнение/неверный severity отклоняются на входе 422.
  По образцу chat-домена (`Field(max_length=...)`). + 2 теста.

## Осознанно НЕ менялось (с обоснованием)

- **`preview-table.css`: убраны zebra/hover/sticky у базового `.preview-table`.**
  Для конструктора это правильно (таблицы под `.preview-sheet` получают
  Word-типографику из `preview-page.css`). Побочно затрагивает портальный
  version-preview (`version-preview.js` рендерит без обёртки `.preview-sheet`,
  `portal.css` не импортит `preview-page.css`) — там пропали полоски/hover/sticky.
  Это косметика вторичной фичи; откат либо вернул бы интерфейсное оформление в
  конструкторский предпросмотр (против замысла единого Word-вида), либо потребовал
  нового скоупящего кода ради фичи, которую владелец не поднимал. По правилу
  «хирургические правки» оставлено как есть — на подтверждение владельцу.
- **`act_content.py`: tree-валидатор отвергает пустое дерево / снапшот без `id`
  корня.** Намеренно строже для нормального пути сохранения; единственный
  остаточный край — рестор/экспорт легаси-снапшота без `id` корня. Стандартная
  установка «обратная совместимость не нужна» + новые снапшоты всегда с `id`
  корня → приемлемо.
- **NITs без действий:** теоретическая гонка ленивого upsert состояния
  (защищена PK, процесс-на-юзера); отсутствие уведомления на таймаут ответа
  агента (таймаут уже виден error-блоком в сообщении); кэп бейджа «99+»
  (косметика); дубль-`init()` guard (безопасен сегодня). Дублирование
  test-only модельного кода каскада (`reconcileAfterRiskAdded/Removed`,
  `removeRiskTableNode`) — by design (см. заметку в `cascade.test.mjs`).

## Проверка после правок

- node:test: **189 passed** (188 + 1 новый: пустой colWidths не дефект).
- pytest: **1631 passed** (1629 + 2 новых: 422 на длинный title и неверный severity).
- `node --check` по трём изменённым JS-файлам — без ошибок.

Итог: ветка корректна и готова к слиянию; правки точечные, хирургические,
покрыты тестами.
