# Onboarding нового разработчика

Гид по входу в проект Act Constructor. Рассчитан на ~2-4 недели до состояния «работаю самостоятельно». При первых вопросах сначала ищи в `docs/developer-guide.md` (он — основной справочник), потом в `CLAUDE.md` (per-developer контекст, не коммитится), и только потом спрашивай команду.

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
   JUPYTERHUB_USER=22494524_local-dev    # любые цифры + суффикс
   ```
   Дефолт `.env.example` — `DATABASE__TYPE=greenplum`, для локалки это не подойдёт (требует Kerberos и сетевой доступ к GP).

3. **PostgreSQL локально** — `docker-compose.yml` в репозитории нет, поднимай нативно (любой стандартный PostgreSQL 13+) или через свой docker-контейнер. Создай пустую базу `audit_workstation`; схемы и таблицы приложение создаст само при старте (`create_tables_if_not_exist`).

4. **Запуск сервера** (см. `developer-guide.md §9.1`):
   ```bash
   uvicorn app.main:app --reload --port 8005
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

3. **Доменная терминология** (см. `CLAUDE.md` → Project Overview):
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

Перед каждой задачей проверь раздел Key Patterns в `CLAUDE.md` — там собраны неочевидные правила (например, что нельзя отдавать assistant с `content=null` в LLM, или что фронт обязан гонять `/api/v1/...` через `AppConfig.api.getUrl`).

---

## Чек-лист «готов работать самостоятельно»

- [ ] Запускаю проект локально (PostgreSQL, uvicorn, тесты зелёные).
- [ ] Могу добавить новый эндпоинт в существующий домен (роутер + service + repo).
- [ ] Понимаю разницу между PG- и GP-адаптерами (batch vs statement-by-statement, ограничения PG 9.4).
- [ ] Знаю про `migration_substitutions` (`{SCHEMA}.{PREFIX}<table>`) и зачем они в `schema.sql`.
- [ ] Знаю, какие env-vars обязательны (см. `.env.example`: `DATABASE__*`, `JUPYTERHUB_USER`, опционально `CHAT__*`).
- [ ] Могу написать тест с `mock_conn` + `dependency_overrides` для FastAPI-эндпоинта.
- [ ] Знаю про `CLAUDE.md` (per-developer, в `.gitignore`) и его роль как живого свода неочевидных правил.
- [ ] Знаю, где искать решения частых проблем (`docs/troubleshooting.md`).
