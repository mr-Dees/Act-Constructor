# Onboarding нового разработчика

Гид по входу в проект Act Constructor. Рассчитан на ~2-4 недели до состояния «работаю самостоятельно». При первых вопросах сначала ищи в `docs/developer-guide.md` (он — основной справочник), потом в `docs/troubleshooting.md` для частых проблем, и только потом спрашивай команду.

---

## День 1 — настройка окружения

Цель: запустить сервер локально, увидеть UI, прогнать тесты.

1. **Клонирование и виртуальное окружение** (Python 3.11):
   ```bash
   git clone <repo>
   cd "Act Constructor"
   python -m venv .venv
   .venv\Scripts\activate           # PowerShell: .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   pip install -r requirements-dev.txt
   ```

2. **Конфигурация `.env`** — скопируй `.env.example` в `.env`. Для локальной разработки переключи:
   ```
   DATABASE__TYPE=postgresql
   DATABASE__HOST=localhost
   DATABASE__PORT=5432
   DATABASE__NAME=audit_workstation
   DATABASE__USER=postgres
   DATABASE__PASSWORD=<твой_пароль>
   JUPYTERHUB_USER=22494524_local-dev    # формат «цифры_суффикс»
   ```
   Дефолт `.env.example` — `DATABASE__TYPE=greenplum`, для локалки это не подойдёт (требует Kerberos и сетевой доступ к GP).

   Про `JUPYTERHUB_USER`: формат значения — «цифры_суффикс» (например `22494524_local-dev`). Из этой строки `extract_username_digits()` извлекает **только цифры** — они идут как `PGUSER` при подключении к Greenplum под Kerberos. Суффикс — для удобства разработчика (видно, чей это user), он не влияет на аутентификацию.

   **Минимум для чата (dev):** если `CHAT__API_KEY` не задан, чат падает на init. Либо закомментируй все `CHAT__*` в `.env` (тогда чат-эндпоинты будут отдавать ошибку, но остальное приложение работает), либо укажи любой ключ OpenRouter / GigaChat / SGLang под нужный профиль (`CHAT__PROFILE=openrouter` для dev — самый простой вариант).

3. **PostgreSQL локально** — `docker-compose.yml` в репозитории нет, поднимай нативно (любой стандартный PostgreSQL 13+) или через свой docker-контейнер. Создай пустую базу `audit_workstation`; схемы и таблицы приложение создаст само при старте (`create_tables_if_not_exist`).

4. **Запуск сервера** (см. `developer-guide.md §9.1`). Два равнозначных способа:
   ```bash
   uvicorn app.main:app --reload --port 8005
   # или
   python -m app.main
   ```
   В логе должна появиться строка `Database pool ready: ...` — без неё API будет отдавать `RuntimeError: Database pool не инициализирован`.

5. **Smoke-проверка** — открой `http://localhost:8005/`, должна загрузиться landing-страница портала. Если редиректит на `/api/v1/...` 404 — проверь, что не выставлен `root_path` (он нужен только под JupyterHub).

6. **Тесты**:
   ```bash
   pytest tests/ -q
   ```
   Тесты идут без реальной БД (мокаются через `mock_conn` + `dependency_overrides`), поэтому проходят и при выключенном PostgreSQL.

---

## Неделя 1 — изучение архитектуры

Цель: понимать, какой домен за что отвечает; уметь по URL найти эндпоинт и handler.

1. **Прочитать `docs/developer-guide.md` секции 1–5** — обзор, 3-tier архитектура, backend-паттерны, frontend 3-зонная структура, доменная плагин-система. Это ~80% контекста для повседневной работы.

2. **Доменная плагин-система** — открой `app/domains/acts/__init__.py` и `app/domains/chat/__init__.py`, посмотри как экспортируется `domain: DomainDescriptor`. Каждый домен сам регистрирует свои роуты, схемы БД, навигацию, настройки. Реестр — `app/core/domain_registry.py`.

3. **Доменная терминология** (см. `docs/developer-guide.md` §1.1 «Доменная терминология»):
   - КМ-номера: `КМ-XX-XXXXX` (русские буквы, 2+5 цифр) — номера аудиторских мероприятий.
   - Служебные записки: `Text/YYYY` — для отправленных на рассмотрение актов.
   - Уникальность акта: пара `(km_number_digit, part_number)`.
   - Типы актов: процессная и непроцессная проверка (разная валидация структуры дерева).
   - Предписания — задачи подразделениям.

4. **Побродить по основным страницам** в dev-режиме:
   - `/` — портал, landing.
   - `/acts` — менеджер актов.
   - `/constructor?act_id=<INT>` — редактор акта. Важно: `act_id` — это INTEGER из `acts.id`, не КМ-номер.
   - `/admin` — администрирование, роли.
   - Чат — popup в правом верхнем углу редактора или модалка на портале.

5. **Прочитать релевантные разделы про чат** — `developer-guide.md §7` (AI-ассистент, оркестратор, tools, agent-bridge) и `§7.7` (event-driven фронтенд чата). Это самая комплексная часть проекта.

---

## Неделя 2–4 — первая задача

Цель: собственный PR с тестом и осмысленным описанием.

Типовые задачи для входа:

- **Добавить новый CHECK constraint** в существующую таблицу — пошаговый рецепт в `developer-guide.md §6.5a`. Не забыть про `CHECK_CONSTRAINT_MESSAGES` в `app/core/exceptions.py` и параллельные правки в PG- и GP-схемах.
- **Добавить новое поле в Pydantic-схему** + миграция колонки — см. `§3.5` и `§6.7`.
- **Добавить новый chat tool** (handler + регистрация в реестре) — см. `§7.6`. Имена tools держатся в `app/core/chat/names.py`, при необходимости синхронизировать с фронтендом.
- **Починить мелкий баг с тестом-репродукцией** — TDD: сначала тест, который красный, потом фикс.

Перед каждой задачей сверься с ключевыми неочевидными правилами проекта (полный список — в `docs/developer-guide.md` «Key Patterns»):

- **LLM-эхо tool_call'ов.** Assistant с `content=null` или `arguments=""` в `tool_calls` валит Qwen/SGLang (400 «zero-length, empty document») и GigaChat-proxy (422 `RequestInputValidationException`). Не делать `messages.append(response.choices[0].message)` напрямую — собирать dict вручную с `content=raw_msg.content or ""`, прогоняя `arguments` через `safe_args(raw)` из `app/domains/chat/services/orchestrator_helpers.py`.
- **Frontend fetch под JupyterHub-proxy.** Все `fetch('/api/v1/...')` ОБЯЗАНЫ идти через `AppConfig.api.getUrl('/api/v1/...')`. Прямой относительный URL роутится JupyterHub'ом на `/hub/...` минуя `/user/{user}/proxy/{port}/` → 404. То же для client_action `open_url` (через `resolveProxyUrl`).
- **Глобальные синглтоны на фронте.** `window.X = new ...` (или `window.X = X` после `const`/`class`). `const X = new ...` создаёт переменную в Script-scope и `window.X.method()` падает в undefined.
- **Greenplum 6.x = PostgreSQL 9.4.** В GP-схемах запрещены `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS`, `ON CONFLICT`, `gen_random_uuid()`, `jsonb_set()`. Адаптер GP идёт statement-by-statement и ловит `Duplicate*Error` — дубликаты безопасны.

---

## Чек-лист «готов работать самостоятельно»

- [ ] Запускаю проект локально (PostgreSQL, uvicorn, тесты зелёные).
- [ ] Могу добавить новый эндпоинт в существующий домен (роутер + service + repo).
- [ ] Понимаю разницу между PG- и GP-адаптерами (batch vs statement-by-statement, ограничения PG 9.4).
- [ ] Знаю про `migration_substitutions` (`{SCHEMA}.{PREFIX}<table>`) и зачем они в `schema.sql`.
- [ ] Знаю, какие env-vars обязательны (см. `.env.example`: `DATABASE__*`, `JUPYTERHUB_USER`, опционально `CHAT__*`).
- [ ] Могу написать тест с `mock_conn` + `dependency_overrides` для FastAPI-эндпоинта.
- [ ] Знаю, где искать решения частых проблем (`docs/troubleshooting.md`).
