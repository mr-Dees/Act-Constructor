# Гайд-бук разработчика — Audit Workstation

## Оглавление

- [1. Обзор проекта и быстрый старт](#1-обзор-проекта-и-быстрый-старт)
  - [1.1 Назначение и основные возможности](#11-назначение-и-основные-возможности)
  - [1.2 Требования](#12-требования)
  - [1.3 Установка и первый запуск](#13-установка-и-первый-запуск)
  - [1.4 Структура репозитория](#14-структура-репозитория)
- [2. Архитектура и принципы](#2-архитектура-и-принципы)
  - [2.1 3-tier layered architecture](#21-3-tier-layered-architecture)
  - [2.2 Жизненный цикл приложения](#22-жизненный-цикл-приложения)
  - [2.3 Adapter pattern для мультиБД](#23-adapter-pattern-для-мультибд)
  - [2.4 Domain plugin system](#24-domain-plugin-system)
  - [2.5 Middleware stack](#25-middleware-stack)
- [3. Backend: структура и паттерны](#3-backend-структура-и-паттерны)
  - [3.1 Слои: API -> Services -> Repositories](#31-слои-api---services---repositories)
  - [3.2 FastAPI Depends (DI)](#32-fastapi-depends-di)
  - [3.3 Shared API — как добавить эндпоинт](#33-shared-api--как-добавить-эндпоинт)
  - [3.4 Domain API — как добавить эндпоинт в домен](#34-domain-api--как-добавить-эндпоинт-в-домен)
  - [3.5 Pydantic-схемы](#35-pydantic-схемы)
  - [3.6 Обработка ошибок](#36-обработка-ошибок)
  - [3.7 Полный путь запроса от HTTP до БД](#37-полный-путь-запроса-от-http-до-бд)
- [4. Frontend: 3-зонная архитектура](#4-frontend-3-зонная-архитектура)
  - [4.1 Принцип трех зон](#41-принцип-трех-зон)
  - [4.2 JavaScript: модульная система](#42-javascript-модульная-система)
  - [4.3 CSS: entry points и import chain](#43-css-entry-points-и-import-chain)
  - [4.4 Jinja2-шаблоны](#44-jinja2-шаблоны)
  - [4.5 Proxy-based change tracking (AppState)](#45-proxy-based-change-tracking-appstate)
  - [4.6 Dual-tracking save (StorageManager)](#46-dual-tracking-save-storagemanager)
  - [4.7 Как добавить новый JS-модуль или CSS-компонент](#47-как-добавить-новый-js-модуль-или-css-компонент)
- [5. Доменная система: создание нового домена](#5-доменная-система-создание-нового-домена)
  - [5.1 Минимальная структура домена](#51-минимальная-структура-домена)
  - [5.2 DomainDescriptor: поля и назначение](#52-domaindescriptor-поля-и-назначение)
  - [5.3 Пошаговый пример: создание домена с нуля](#53-пошаговый-пример-создание-домена-с-нуля)
  - [5.4 Настройки домена (settings_registry)](#54-настройки-домена-settings_registry)
  - [5.5 Навигация (NavItem)](#55-навигация-navitem)
  - [5.6 Knowledge bases и chat_system_prompt](#56-knowledge-bases-и-chat_system_prompt)
  - [5.7 Жизненный цикл домена](#57-жизненный-цикл-домена)
  - [5.8 Зависимости между доменами](#58-зависимости-между-доменами)
- [6. База данных](#6-база-данных)
  - [6.1 Схема: основные и справочные таблицы](#61-схема-основные-и-справочные-таблицы)
  - [6.2 Адаптеры (PostgreSQL vs Greenplum)](#62-адаптеры-postgresql-vs-greenplum)
  - [6.3 Пул подключений (asyncpg)](#63-пул-подключений-asyncpg)
  - [6.4 BaseRepository: паттерн работы с БД](#64-baserepository-паттерн-работы-с-бд)
  - [6.5 Миграции](#65-миграции)
  - [6.6 JSON/JSONB утилиты](#66-jsonjsonb-утилиты)
  - [6.7 Пример: добавление новой таблицы](#67-пример-добавление-новой-таблицы)
- [7. AI-ассистент](#7-ai-ассистент)
  - [7.1 Архитектура: chat endpoint -> LLM -> tool_calls](#71-архитектура-chat-endpoint---llm---tool_calls)
  - [7.2 ChatTool и ChatToolParam](#72-chattool-и-chattoolparam)
  - [7.3 Реестр chat tools](#73-реестр-chat-tools)
  - [7.4 Agent loop](#74-agent-loop)
  - [7.5 Knowledge bases](#75-knowledge-bases)
  - [7.6 Пример: добавление нового chat tool](#76-пример-добавление-нового-chat-tool)
  - [7.7 Фронтенд: event-driven архитектура чата](#77-фронтенд-event-driven-архитектура-чата)
- [8. Тестирование](#8-тестирование)
  - [8.1 Стек и структура](#81-стек-и-структура)
  - [8.2 Фикстуры: сброс реестров](#82-фикстуры-сброс-реестров)
  - [8.3 Тестирование API](#83-тестирование-api)
  - [8.4 Тестирование сервисов и репозиториев](#84-тестирование-сервисов-и-репозиториев)
  - [8.5 Пример: тест для нового эндпоинта](#85-пример-тест-для-нового-эндпоинта)
- [9. Деплой и инфраструктура](#9-деплой-и-инфраструктура)
  - [9.1 Standalone (uvicorn)](#91-standalone-uvicorn)
  - [9.2 За JupyterHub proxy](#92-за-jupyterhub-proxy)
  - [9.3 За reverse proxy (HTTPS)](#93-за-reverse-proxy-https)
  - [9.4 Конфигурация: .env и Pydantic Settings](#94-конфигурация-env-и-pydantic-settings)
  - [9.5 Полная таблица переменных окружения](#95-полная-таблица-переменных-окружения)

---

## 1. Обзор проекта и быстрый старт

### 1.1 Назначение и основные возможности

Audit Workstation — веб-приложение для создания и управления актами аудиторских проверок. Все пользовательские интерфейсы и доменная терминология на русском языке.

**Основные возможности:**

- Создание и редактирование актов проверок с иерархической структурой (дерево разделов)
- Работа с таблицами, текстовыми блоками и карточками нарушений
- Экспорт актов в DOCX, Markdown и текстовый формат
- Система блокировок для совместной работы (exclusive editing)
- AI-ассистент с function-calling для извлечения и анализа данных актов
- Аудит-лог изменений и версионирование содержимого
- Прикрепление фактур к пунктам акта (Hive/Greenplum)
- Ролевая модель доступа (Куратор, Руководитель, Редактор, Участник)

**Доменная терминология:**

| Термин | Описание |
|--------|----------|
| КМ-номер | Номер контрольного мероприятия (формат `КМ-XX-XXXXX`) |
| Служебная записка | Номер документа при отправке руководству (формат `Текст/ГГГГ`) |
| Поручение (directive) | Задача структурному подразделению на исправление/улучшение |
| Фактура (invoice) | Привязка к таблице данных в Hive/Greenplum |

### 1.2 Требования

| Компонент | Версия | Назначение |
|-----------|--------|-----------|
| Python | 3.11+ | Runtime |
| PostgreSQL | 14+ | Основная БД (разработка и production) |
| Greenplum | 6+ | Альтернативная БД (DataLab) |
| asyncpg | 0.31.0 | Асинхронный драйвер PostgreSQL |
| FastAPI | 0.135.0 | Web фреймворк |
| uvicorn | 0.38.0 | ASGI сервер |
| pydantic | 2.12.4 | Валидация данных |
| pydantic-settings | 2.6.1 | BaseSettings для конфигурации из .env |
| python-docx | 1.2.0 | Генерация .docx |
| openai | 2.28.0 | OpenAI-совместимый API клиент |
| gssapi | 1.10.1 | Kerberos аутентификация (для Greenplum) |
| cachetools | 6.2.2 | TTLCache для rate limiting |

### 1.3 Установка и первый запуск

**Локальная разработка (PostgreSQL):**

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd "Act Constructor"

# 2. Создать виртуальное окружение
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows

# 3. Установить зависимости
pip install -r requirements.txt

# 4. Создать .env (скопировать из шаблона)
cp .env.example .env
# Отредактировать .env — указать параметры БД

# 5. Запустить
python -m app.main
```

Приложение будет доступно по адресу `http://localhost:8000`.

**DataLab / JupyterHub (Greenplum):**

```bash
# 1. Авторизоваться через Kerberos
kinit

# 2. Настроить .env
DATABASE__TYPE=greenplum
DATABASE__GP__HOST=gp_dns_pkap1123_audit.gp.df.sbrf.ru
DATABASE__GP__SCHEMA=s_grnplm_ld_audit_da_project_4

# 3. Запустить
python -m app.main
```

Таблицы создаются автоматически при первом запуске.

### 1.4 Структура репозитория

```
Act Constructor/
├── app/                          — основной пакет приложения
│   ├── main.py                   — точка входа FastAPI (app factory, lifespan)
│   ├── core/                     — ядро (config, middleware, domain registry)
│   ├── db/                       — БД (adapters, connection pool, base repository)
│   ├── domains/                  — доменные плагины (acts, admin, ck_*)
│   ├── api/v1/                   — shared API (auth, system, roles)
│   ├── routes/                   — shared HTML routes
│   ├── schemas/                  — shared Pydantic-модели
│   ├── services/                 — shared сервисы
│   ├── formatters/               — shared утилиты форматирования
│   └── integrations/             — shared интеграции
├── static/                       — CSS, JS, изображения
│   ├── css/                      — 3-зонная CSS архитектура
│   └── js/                       — 3-зонная JS архитектура
├── templates/                    — Jinja2 шаблоны
├── tests/                        — pytest тесты
├── docs/                         — документация
├── scripts/                      — вспомогательные скрипты
├── acts_storage/                 — файловое хранилище актов (StorageService)
├── .env.example                  — шаблон конфигурации
├── requirements.txt              — зависимости
├── requirements-dev.txt          — dev-зависимости (pytest и т.д.)
├── pytest.ini                    — конфигурация pytest
└── CLAUDE.md                     — инструкции для AI-ассистента разработки
```

---

## 2. Архитектура и принципы

### 2.1 3-tier layered architecture

Приложение построено по трехслойной архитектуре с доменной plugin-системой:

```
Browser (vanilla JS)
    ↓ HTTP/JSON + HTML
FastAPI Application (app/main.py)
    ├── Middleware (HTTPS → RequestSize → RateLimit)
    ├── Shared HTML Routes (portal — landing page)
    ├── Shared API Routes (auth, system, roles)
    ├── Domain Plugin Registry (domain_registry.py)
    │   └── acts/     — API, routes, services, repositories
    │   └── admin/    — API, routes, services, repositories
    │   └── chat/     — AI-ассистент (SSE-стриминг, conversation persistence)
    │   └── ck_*/     — верификация метрик
    └── Database Layer
        ├── Connection Pool (asyncpg)
        ├── Adapters (PostgreSQL | Greenplum)
        └── Base Repository (conn + adapter)
```

**Принципы:**
- Каждый слой зависит только от нижележащего
- Бизнес-логика в сервисах, SQL-запросы в репозиториях
- API-эндпоинты тонкие — только вызов сервисов и возврат результата
- Домены изолированы друг от друга (кроме явных зависимостей)

### 2.2 Жизненный цикл приложения

Приложение управляется фабрикой `create_app()` в `app/main.py`.

**Порядок инициализации:**

```
1. Settings         — загрузка конфигурации из .env
2. Logging          — настройка уровня логирования
3. Middleware       — добавление в обратном порядке (см. раздел 2.5)
4. Static files     — монтирование /static и /favicon.ico
5. Exception handlers — регистрация обработчиков ошибок
6. Router registration:
   ├── Shared HTML routes
   ├── Shared API routes
   └── Domain API/HTML routes    — автоматически через domain_registry
7. Lifespan startup (при запуске ASGI-сервера):
   ├── ensure_directories()      — проверка templates/ и static/
   ├── init_db(settings)                    — создание asyncpg пула
   ├── create_tables_if_not_exist(domains) — автосоздание таблиц из schema.sql
   └── domain.on_startup()       — для каждого домена (с откатом при ошибке)
```

**Порядок остановки:**

```
1. domain.on_shutdown()  — в обратном порядке (только стартовавшие домены)
2. close_db()            — закрытие asyncpg пула
```

**Защита от частичного старта:** если домен N падает при startup, вызываются `on_shutdown()` для доменов 1..N-1:

```python
started: list = []
for d in domains:
    if d.on_startup:
        await d.on_startup(app)
    started.append(d)
# При ошибке:
for d in reversed(started):
    if d.on_shutdown:
        await d.on_shutdown(app)
```

### 2.3 Adapter pattern для мультиБД

Приложение поддерживает две СУБД через паттерн Adapter. Подробнее см. [раздел 6.2](#62-адаптеры-postgresql-vs-greenplum).

```
DatabaseAdapter (абстрактный)
    ├── PostgreSQLAdapter   — простые имена таблиц, CASCADE, GIN-индексы
    └── GreenplumAdapter    — квалифицированные имена, BIGSERIAL, Kerberos
```

Адаптер выбирается при старте по значению `DATABASE__TYPE` и доступен глобально через `get_adapter()`.

### 2.4 Domain plugin system

Домены обнаруживаются автоматически сканированием директории `app/domains/`. Каждый домен — изолированный Python-пакет с `__init__.py`, экспортирующим `_build_domain() -> DomainDescriptor`.

Подробнее о создании доменов см. [раздел 5](#5-доменная-система-создание-нового-домена).

**Текущие домены:**

| Домен | Статус | Описание |
|-------|--------|----------|
| `acts` | Основной | Создание и управление актами |
| `admin` | Активный | Администрирование, управление ролями |
| `chat` | Активный | AI-ассистент (conversations, SSE-стриминг, function-calling, файлы). Фронтенд: event-driven (6 модулей через ChatEventBus) |
| `ck_fin_res` | Активный | ЦК Финансовый результат — верификация метрик FR |
| `ck_client_exp` | Активный | ЦК Клиентский опыт — верификация метрик CS |
| `ua_data` | Активный | Справочные данные УА — словари процессов, ТБ, подразделений, метрик нарушений. Зависит от `admin` |

### 2.5 Middleware stack

Четыре middleware добавляются в `create_app()`. Порядок добавления обратный порядку выполнения (последний добавленный выполняется первым):

```python
# main.py — порядок добавления:
app.add_middleware(HTTPSRedirectMiddleware)         # добавлен 1-м
app.add_middleware(RequestSizeLimitMiddleware, ...) # добавлен 2-м
app.add_middleware(RateLimitMiddleware, ...)        # добавлен 3-м
app.add_middleware(RequestIdMiddleware)             # добавлен 4-м (выполняется 1-м)
```

**Порядок выполнения при запросе:**

```
Запрос → RequestId → RateLimit → RequestSizeLimit → HTTPSRedirect → FastAPI → Ответ
```

| Middleware | Файл | Назначение |
|-----------|------|-----------|
| `RequestIdMiddleware` | `app/core/middleware.py` | Назначает уникальный `request_id` из заголовка `X-Request-ID` или генерирует короткий UUID. Сохраняет в `ContextVar` для логов, возвращает в заголовке ответа |
| `RateLimitMiddleware` | `app/core/middleware.py` | Rate limiting через TTLCache. По умолчанию 1024 req/min на IP |
| `RequestSizeLimitMiddleware` | `app/core/middleware.py` | Ограничивает размер тела запроса (raw ASGI для streaming-контроля). По умолчанию 10MB |
| `HTTPSRedirectMiddleware` | `app/core/middleware.py` | Переписывает `scheme` на `https` по заголовкам `x-forwarded-proto` / `x-scheme` |

> **Почему `RequestSizeLimitMiddleware` реализован как raw ASGI:** `BaseHTTPMiddleware` буферизует всё тело до `dispatch()`, что не позволяет контролировать размер при chunked transfer encoding.

---

## 3. Backend: структура и паттерны

### 3.1 Слои: API -> Services -> Repositories

```
Эндпоинт (HTTP)
    ↓ FastAPI Depends()
Service (бизнес-логика)
    ├── AccessGuard — проверка доступа
    ├── Repository  — SQL-запросы
    ├── Валидация, трансформация
    └── Repository  — сохранение
    ↓
Ответ клиенту
```

**Shared API** (`app/api/v1/`):

```
app/api/v1/
├── routes.py              — главный роутер (агрегирует shared endpoints)
├── deps/
│   ├── auth_deps.py       — get_username() — проверка авторизации
│   └── role_deps.py       — require_admin() — проверка роли Админ
└── endpoints/
    ├── auth.py            — GET /me, /validate
    ├── roles.py           — /roles/ (интеграция с admin доменом)
    └── system.py          — health, version
```

**Domain API** (`app/domains/acts/api/`):

```
app/domains/acts/api/
├── __init__.py            — get_api_routers() → [(router, prefix, tags)]
├── management.py          — CRUD + блокировка
├── content.py             — загрузка/сохранение содержимого
├── export.py              — экспорт в форматы
├── invoice.py             — работа с фактурами
├── audit_log.py           — история операций
└── users.py               — поиск пользователей для autocomplete участников
```

**Сервисы домена актов:**

| Сервис | Файл | Назначение |
|--------|------|-----------|
| `ActCrudService` | `act_crud_service.py` | CRUD, управление метаданными |
| `ActLockService` | `act_lock_service.py` | Блокировка с инактивностью |
| `ActContentService` | `act_content_service.py` | Содержимое (дерево, таблицы, текст) |
| `ActInvoiceService` | `act_invoice_service.py` | CRUD фактур, валидация метрик |
| `ExportService` | `export_service.py` | Форматирование через ThreadPoolExecutor |
| `StorageService` | `storage_service.py` | Файловый I/O (`acts_storage/`) |
| `AuditLogService` | `audit_log_service.py` | История операций, восстановление версий |
| `AccessGuard` | `access_guard.py` | Проверка доступа и прав |

**Репозитории домена актов** (`app/domains/acts/repositories/`):

| Репозиторий | Файл | Назначение |
|-------------|------|-----------|
| `ActCrudRepository` | `act_crud.py` | CRUD-операции с метаданными актов |
| `ActContentRepository` | `act_content.py` | Чтение дерева, таблиц, текстблоков, нарушений |
| `ActContentVersionRepository` | `act_content_version.py` | Снимки содержимого для истории |
| `ActLockRepository` | `act_lock.py` | Блокировка актов (pessimistic locking) |
| `ActAccessRepository` | `act_access.py` | Управление доступом и правами |
| `ActInvoiceRepository` | `act_invoice.py` | CRUD фактур |
| `ActAuditLogRepository` | `act_audit_log.py` | Запись и чтение журнала операций |
| `ActUsersRepository` | `act_users.py` | Поиск пользователей в справочнике (autocomplete) |

**Форматтеры экспорта** (`app/domains/acts/formatters/`):

| Форматтер | Файл | Назначение |
|-----------|------|-----------|
| `DocxFormatter` | `docx_formatter.py` | Экспорт акта в DOCX (python-docx) |
| `MarkdownFormatter` | `markdown_formatter.py` | Экспорт акта в Markdown |
| `TextFormatter` | `text_formatter.py` | Экспорт акта в plain text |

Базовый класс форматтеров — `app/formatters/base_formatter.py` (общий интерфейс и обход дерева).

Общие утилиты в `app/formatters/utils/`:

| Утилита | Файл | Назначение |
|---------|------|-----------|
| `formatting_utils.py` | Текстовые утилиты | Форматирование строк, отступов |
| `html_utils.py` | HTML-утилиты | Парсинг и очистка HTML-контента |
| `json_utils.py` | JSON-утилиты | Трансформация JSON-структур |
| `table_utils.py` | Табличные утилиты | Форматирование табличных данных |

### 3.2 FastAPI Depends (DI)

Все сервисы получают `asyncpg.Connection` из пула через async generator:

```python
# app/domains/acts/deps.py
async def get_crud_service(
    settings: Settings = Depends(get_settings),
) -> AsyncGenerator[ActCrudService, None]:
    async with get_db() as conn:
        yield ActCrudService(conn=conn, settings=settings)
```

**Цепочка зависимостей:**

```
Эндпоинт
    ↓ Depends()
    ├── get_username() → str (или HTTPException 401)
    └── get_crud_service() → async generator
        └── get_db() → asyncpg.Connection из пула
            └── Service.__init__(conn, settings)
                └── Repository(conn)
                    └── self.adapter = get_adapter()
```

Connection автоматически возвращается в пул после завершения запроса.

**Auth dependency** (`app/api/v1/deps/auth_deps.py`):

```python
def get_username() -> str:
    username = get_current_user_from_env()
    if not username:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return username
```

### 3.3 Shared API — как добавить эндпоинт

**Шаг 1.** Добавить функцию в существующий файл `app/api/v1/endpoints/*.py` или создать новый:

```python
# app/api/v1/endpoints/auth.py
@router.post("/logout", status_code=200)
async def logout(username: str = Depends(get_username)):
    logger.info(f"Пользователь {username} вышел из системы")
    return {"message": "Успешно вышли из системы"}
```

**Шаг 2.** Если создан новый файл — зарегистрировать в `app/api/v1/routes.py`:

```python
from app.api.v1.endpoints import auth, system, roles, new_module

ROUTERS = [
    (auth, "/auth", ["Авторизация"]),
    (system, "/system", ["Системные операции"]),
    (roles, "/roles", ["Роли пользователей"]),
    (new_module, "/new", ["Новый модуль"]),  # добавить
]
```

Результат: эндпоинт доступен по `POST /api/v1/auth/logout`.

### 3.4 Domain API — как добавить эндпоинт в домен

**Шаг 1.** Создать файл `app/domains/acts/api/status.py`:

```python
from fastapi import APIRouter, Depends
from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.deps import get_crud_service

router = APIRouter()

@router.get("/{act_id}/status")
async def get_act_status(
    act_id: int,
    username: str = Depends(get_username),
    service: ActCrudService = Depends(get_crud_service),
):
    act = await service.get_act(act_id, username)
    return {"act_id": act.id, "locked": act.locked_by is not None}
```

**Шаг 2.** Зарегистрировать в `app/domains/acts/api/__init__.py`:

```python
from app.domains.acts.api.status import router as status_router

def get_api_routers():
    return [
        # ... существующие
        (status_router, "/acts", ["Статус актов"]),
    ]
```

Результат: `GET /api/v1/acts/{act_id}/status`.

### 3.5 Pydantic-схемы

Схемы запросов и ответов определяются в `app/domains/acts/schemas/`:

| Файл | Модели |
|------|--------|
| `act_metadata.py` | `ActCreate`, `ActUpdate`, `AuditTeamMember`, `ActDirective`, `UserSearchResult` |
| `act_content.py` | `ActItemSchema`, `TableSchema`, `TextBlockSchema`, `ViolationSchema`, `ActDataSchema`, `ActSaveResponse` |
| `act_invoice.py` | `InvoiceSave`, `MetricItem` |
| `act_audit_log.py` | Модели для аудит-лога |
| `act_responses.py` | Модели ответов API (списки актов, метаданные, статусы) |

Схемы чата определены в домене `app/domains/chat/schemas/`:

```python
# app/domains/chat/schemas/requests.py
class CreateConversationRequest(BaseModel):
    domain_name: str | None = None
    context: dict | None = None

class UpdateConversationRequest(BaseModel):
    title: str

# app/domains/chat/schemas/responses.py
class ConversationResponse(BaseModel):
    id: int
    title: str
    domain_name: str | None
    created_at: datetime
    updated_at: datetime

class MessageResponse(BaseModel):
    id: int
    role: str
    content: list[dict]
    created_at: datetime
```

Сообщения отправляются через `FormData` (message + files + domains), не через JSON body.

### 3.6 Обработка ошибок

**Базовый класс** (`app/core/exceptions.py`):

```python
class AppError(Exception):
    status_code: int = 500

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)

    def to_detail(self) -> dict:
        return {"detail": self.message}
```

**Доменные исключения** (`app/domains/acts/exceptions.py`):

| Исключение | HTTP-код | Назначение |
|-----------|----------|-----------|
| `ActNotFoundError` | 404 | Акт не найден |
| `AccessDeniedError` | 403 | Нет доступа |
| `InsufficientRightsError` | 403 | Роль не позволяет |
| `ActLockError` | 409 | Конфликт блокировки |
| `KmConflictError` | 409 | КМ уже существует |
| `ActValidationError` | 400 | Бизнес-валидация |
| `UnsupportedFormatError` | 400 | Неподдерживаемый формат экспорта |
| `ManagementRoleRequiredError` | 403 | Требуется Куратор/Руководитель |
| `InvoiceError` | 400 | Ошибка фактуры |

**Exception handlers** регистрируются в `main.py` и работают автоматически:

```python
@app.exception_handler(AppError)
async def app_error_handler(request, exc):
    if _is_html_request(request):
        return _render_error_page(request, exc.status_code)
    return JSONResponse(status_code=exc.status_code, content=exc.to_detail())
```

Нет необходимости в try-except в эндпоинтах — достаточно бросить исключение из сервиса.

### 3.7 Полный путь запроса от HTTP до БД

Пример: `GET /api/v1/acts/list` — получение списка актов.

```
1. HTTP запрос → Middleware chain (HTTPS → Size → RateLimit)
2. FastAPI routing → acts/api/management.py:get_acts_list()
3. Depends(get_username) → извлечение username из окружения
4. Depends(get_crud_service):
   a. get_db() → asyncpg.Connection из пула
   b. ActCrudService(conn, settings)
5. service.list_acts(username):
   a. self._crud.get_user_acts(username) → SQL SELECT
   b. Возврат [ActListItem, ...]
6. FastAPI → JSON response → клиент
7. Connection возвращается в пул (async generator cleanup)
```

---

## 4. Frontend: 3-зонная архитектура

### 4.1 Принцип трех зон

Все frontend-ресурсы организованы в три зоны:

| Зона | Назначение | Используется |
|------|-----------|-------------|
| `shared/` | Кросс-функциональный код | Portal + Constructor |
| `portal/` | Страницы с боковой навигацией | Landing, Acts Manager, Admin |
| `constructor/` | Редактор актов | Constructor |

Код shared-зоны никогда не дублируется. Каждая зона имеет свою CSS entry point, базовый шаблон и набор JS-модулей.

**Страницы приложения:**

| Страница | URL | Базовый шаблон | JS точка входа |
|----------|-----|---------------|----------------|
| Landing | `GET /` | `base_portal.html` | `landing-page.js` |
| Acts Manager | `GET /acts` | `base_portal.html` | `acts-manager-page.js` |
| Constructor | `GET /constructor?act_id=X` | `base_constructor.html` | `app.js` |
| Admin | `GET /admin` | `base_portal.html` | `admin-page.js` |
| CK (заглушки) | `GET /ck-*` | `base_portal.html` | — |

### 4.2 JavaScript: модульная система

Vanilla JS (ES6+) без фреймворков и бандлеров. ~87 модулей, загружаемых через `<script>` теги в шаблонах.

**Shared (`static/js/shared/` — 20 модулей):**

| Модуль | Назначение |
|--------|-----------|
| `app-config.js` | Центральная конфигурация (URL, типы узлов, пресеты) |
| `auth.js` | Авторизация JupyterHub/Kerberos |
| `api.js` | HTTP-клиент для всех запросов |
| `notifications.js` | Система toast-уведомлений |
| `chat/chat-event-bus.js` | Шина событий чата (pub/sub) — связывает все chat-модули |
| `chat/chat-ui.js` | UI-контроллер (typing-индикатор, блокировка ввода, scroll, авторесайз) |
| `chat/chat-files.js` | Файлы (валидация, drag-drop, превью, лимиты) |
| `chat/chat-context.js` | Контекст (беседы, knowledge bases, домены) |
| `chat/chat-messages.js` | Сообщения (отправка через SSE, рендеринг user/bot, обработка SSE-событий) |
| `chat/chat-stream.js` | SSE-клиент для стриминга сообщений |
| `chat/chat-renderer.js` | Рендеринг блоков сообщений (text, code, reasoning, plan, file, image, buttons) |
| `chat/chat-history.js` | Панель истории разговоров (CRUD, переключение) |
| `chat/chat-manager.js` | Фасад чата (инициализация модулей, публичный API, обратная совместимость) |
| `chat/chat-modal.js` | Модальное окно чата для portal |
| `dialog/dialog-base.js` | Базовый класс диалогов |
| `dialog/dialog-confirm.js` | Promise-based confirm/alert |
| `ck/ck-form.js` | Форма верификации метрик для ЦК-доменов |
| `ck/ck-pagination.js` | Пагинация таблиц ЦК |
| `ck/ck-process-picker.js` | Выбор процесса для ЦК |
| `ck/ck-table.js` | Табличный компонент ЦК |

**Portal (`static/js/portal/` — 18 модулей):**

```
portal/
├── portal-sidebar.js                       — боковая навигация
├── portal-settings.js                      — пользовательские настройки
├── landing/
│   └── landing-page.js                     — главная страница
├── acts-manager/
│   ├── acts-manager-page.js                — управление актами
│   ├── dialog-create-act.js                — диалог создания акта
│   ├── dialog-audit-log.js                 — диалог аудит-лога (история версий)
│   ├── diff-engine.js                      — логика сравнения версий
│   ├── diff-renderer.js                    — рендеринг diff-ов
│   ├── team-member-search.js               — autocomplete участников
│   └── version-preview.js                  — предпросмотр версий
├── admin/
│   ├── admin-page.js                       — страница администрирования
│   ├── admin-roles.js                      — управление ролями
│   ├── admin-search.js                     — поиск пользователей
│   └── admin-add-user-dialog.js            — диалог добавления пользователя
├── ck-fin-res/
│   ├── ck-fin-res-config.js                — конфигурация ЦК ФинРез
│   └── ck-fin-res-page.js                  — страница верификации метрик FR
└── ck-client-exp/
    ├── ck-client-exp-config.js             — конфигурация ЦК Клиентский опыт
    └── ck-client-exp-page.js               — страница верификации метрик CS
```

**Constructor (`static/js/constructor/` — 50 модулей):**

```
constructor/
├── app.js                    — главная инициализация
├── storage-manager.js        — localStorage + DB sync
├── lock-manager.js           — блокировки + inactivity
├── changelog-tracker.js      — отслеживание операций
├── state/                    — управление состоянием (AppState)
├── tree/                     — редактор структуры (TreeManager)
├── table/                    — редактор таблиц (TableManager)
├── textblock/                — редактор текста (TextBlockManager)
├── violation/                — редактор нарушений (ViolationManager)
├── preview/                  — live preview
├── context-menu/             — контекстные меню
├── validation/               — валидация перед сохранением
├── header/                   — шапка (exit, acts-menu, format, chat, preview, settings)
├── items/                    — рендеринг контента (Step 2)
├── dialog/                   — диалоги (help, invoice)
└── services/                 — генерация ID
```

**Паттерн Delegated Managers:** основной менеджер делегирует обязанности специализированным классам:

```javascript
class TreeManager {
    constructor(containerId) {
        this.renderer = new TreeRenderer(this);  // рендеринг DOM
        this.dragDrop = new TreeDragDrop(this);  // перетаскивание
    }
}
```

### 4.3 CSS: entry points и import chain

3 entry point файла, каждый для своей зоны:

```
static/css/entry/
├── shared.css       — base + cross-cutting
├── portal.css       — @import shared.css + portal-specific
└── constructor.css  — @import shared.css + constructor-specific
```

**Import chain:**

```
constructor.css → shared.css → base/ (variables, reset, animations)
                              → shared/ (buttons, notifications, dialog, chat)
portal.css     → shared.css → (то же самое)
```

**CSS-переменные** определены в `static/css/base/variables.css`:

```css
:root {
    --primary: #5b6fa8;
    --primary-hover: #4a5d8a;
    --success: #52a876;
    --warning: #d89849;
    --error: #c75555;
    --bg-primary: #ffffff;
    --text-primary: #1a202c;
    /* ... */
}
```

### 4.4 Jinja2-шаблоны

Две независимые базы наследования — по одной на зону:

```
templates/
├── shared/                      — компоненты, используемые везде
│   ├── chat_content.html        — переиспользуемый чат
│   ├── dialog.html              — подтверждение
│   └── errors/                  — страницы ошибок (base_error.html, 400, 401, 403, 404, 500, 503)
├── portal/
│   ├── base_portal.html         — БАЗОВЫЙ ШАБЛОН (portal.css + shared JS)
│   ├── landing/                 — extends base_portal
│   ├── acts-manager/            — extends base_portal (+ components/)
│   ├── admin/                   — extends base_portal
│   ├── ck/                      — ЦК-страницы (ck_fin_res.html, ck_client_experience.html)
│   └── layout/                  — sidebar, topbar
└── constructor/
    ├── base_constructor.html    — БАЗОВЫЙ ШАБЛОН (constructor.css + ~70 JS)
    ├── constructor.html         — extends base_constructor
    ├── header/                  — компоненты шапки (12 шаблонов, включая help/)
    └── components/              — tree panel, preview, context menu
```

**Базовый шаблон portal** (`base_portal.html`) загружает:
- `css/entry/portal.css`
- Shared JS: `app-config.js`, `auth.js`, `api.js`, `notifications.js`, `dialog-*`
- Portal JS: `portal-sidebar.js`, `chat-stream.js`, `chat-renderer.js`, `chat-history.js`, `chat-event-bus.js`, `chat-ui.js`, `chat-files.js`, `chat-context.js`, `chat-messages.js`, `chat-manager.js`, `chat-modal.js`, `portal-settings.js`

**Базовый шаблон constructor** (`base_constructor.html`) загружает:
- `css/entry/constructor.css`
- Все ~70 JS модулей (shared + constructor) в определенном порядке

### 4.5 Proxy-based change tracking (AppState)

`AppState` — plain object с методами, расширяемый через `Object.assign()`:

```javascript
// state-core.js
const AppState = {
    currentStep: 1,
    treeData: null,
    tables: {},
    textBlocks: {},
    violations: {},

    initializeTree(isProcessBased = true) {
        this.treeData = this._createRootStructure(isProcessBased);
        this._createInitialTables(isProcessBased);
        return this.treeData;
    },
};

// state-tree.js — расширение
Object.assign(AppState, {
    generateNumbering(node = this.treeData, prefix = '') { /* ... */ },
    // операции с деревом
});

// state-content.js — расширение
Object.assign(AppState, {
    // операции с таблицами, текстблоками, нарушениями
});
```

Отслеживание изменений реализовано через `Object.defineProperty` — метод `_wrapStateWithProxy` перехватывает запись в отслеживаемые свойства и автоматически вызывает `StorageManager.markAsUnsaved()`.

### 4.6 Dual-tracking save (StorageManager)

`StorageManager` отслеживает два уровня синхронизации:

```
Красный    → изменения в памяти, не сохранены
Желтый     → сохранено в localStorage, не синхронизировано с БД
Белый      → синхронизировано с БД
```

**Параметры:**
- Автосохранение с дебаунсом: 3 секунды
- Периодическое сохранение: каждые 2 минуты
- Максимум данных в localStorage: 4MB

```javascript
class StorageManager {
    static _hasUnsavedChanges = false;   // localStorage
    static _isSyncedWithDB = true;       // БД

    static init() {
        this._checkLocalStorageAvailable();
        this._setupEventHandlers();
        this._updateSaveIndicator();
    }
}
```

### 4.7 Как добавить новый JS-модуль или CSS-компонент

**Добавление JS-модуля:**

1. Создать файл в соответствующей зоне: `static/js/<zone>/<module>.js`
2. Добавить `<script>` тег в базовый шаблон зоны (`base_portal.html` или `base_constructor.html`)
3. Порядок загрузки важен: зависимости должны быть загружены раньше

**Добавление CSS-компонента:**

1. Создать файл: `static/css/<zone>/<category>/<component>.css`
2. Добавить `@import` в entry point зоны:
   - Shared: `static/css/entry/shared.css` — автоматически доступен везде
   - Portal: `static/css/entry/portal.css`
   - Constructor: `static/css/entry/constructor.css`

Пример: новый shared-компонент `modal-header`:

```css
/* static/css/entry/shared.css — добавить: */
@import '../shared/modal/modal-header.css';
```

Оба entry point (`portal.css` и `constructor.css`) получат стили автоматически через импорт `shared.css`.

---

## 5. Доменная система: создание нового домена

### 5.1 Минимальная структура домена

```
app/domains/<name>/
├── __init__.py          — обязательно: _build_domain() → DomainDescriptor
├── settings.py          — опционально: BaseModel с настройками
├── deps.py              — опционально: FastAPI Depends
├── exceptions.py        — опционально: наследники AppError
├── _lifecycle.py        — опционально: on_startup / on_shutdown
├── api/
│   ├── __init__.py      — get_api_routers() → [(router, prefix, tags)]
│   └── <endpoints>.py   — APIRouter
├── routes/
│   ├── __init__.py      — get_html_routers() → [router]
│   └── <pages>.py       — HTML-роуты (Jinja2)
├── services/            — бизнес-логика
├── repositories/        — доступ к БД (наследуют BaseRepository)
├── schemas/             — Pydantic-модели
├── integrations/
│   └── chat_tools.py    — определения ChatTool для AI
└── migrations/
    ├── postgresql/schema.sql
    └── greenplum/schema.sql
```

### 5.2 DomainDescriptor: поля и назначение

```python
@dataclass
class DomainDescriptor:
    name: str                    # уникальное имя домена
    api_routers: list[tuple]     # [(router, prefix, tags), ...]
    html_routers: list           # [router, ...]
    settings_class: type | None  # BaseModel для загрузки из .env
    exception_handlers: dict     # {ExcClass: handler_fn}
    dependencies: list[str]      # имена доменов-зависимостей
    on_startup: Callable | None  # async def on_startup(app)
    on_shutdown: Callable | None # async def on_shutdown(app)
    package_path: Path | None    # заполняется автоматически
    chat_tools: list[ChatTool]   # инструменты для AI
    nav_items: list[NavItem]     # элементы sidebar
    knowledge_bases: list        # базы знаний для AI
    chat_system_prompt: str      # промпт для AI-ассистента
    migration_substitutions: dict # плейсхолдеры для schema.sql
```

### 5.3 Пошаговый пример: создание домена с нуля

Создадим домен `reports` для генерации отчетов.

**Шаг 1: `__init__.py`**

```python
"""Домен отчетов."""

def _build_domain():
    from app.core.domain import DomainDescriptor, NavItem
    from app.domains.reports.api import get_api_routers
    from app.domains.reports.routes import get_html_routers
    from app.domains.reports.settings import ReportsSettings

    return DomainDescriptor(
        name="reports",
        api_routers=get_api_routers(),
        html_routers=get_html_routers(),
        settings_class=ReportsSettings,
        dependencies=["acts"],  # зависит от домена актов
        nav_items=[
            NavItem(
                label="Отчеты",
                url="/reports",
                icon_svg='<path d="..." stroke="currentColor"/>',
                order=15,
                active_page="reports",
                chat_domains=["reports", "acts"],
                group="Аудит",
            ),
        ],
    )
```

**Шаг 2: `settings.py`**

```python
from pydantic import BaseModel

class ReportsSettings(BaseModel):
    max_report_size_mb: float = 50.0
    default_format: str = "docx"
```

**Шаг 3: `api/__init__.py`**

```python
from app.domains.reports.api.endpoints import router

def get_api_routers():
    return [(router, "/reports", ["Отчеты"])]
```

**Шаг 4: `api/endpoints.py`**

```python
from fastapi import APIRouter, Depends
from app.api.v1.deps.auth_deps import get_username

router = APIRouter()

@router.get("/list")
async def list_reports(username: str = Depends(get_username)):
    return {"reports": []}
```

**Шаг 5: `migrations/postgresql/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

После создания файлов домен обнаружится автоматически при запуске приложения.

### 5.4 Настройки домена (settings_registry)

Доменные настройки загружаются из `.env` с префиксом `NAME__`. Механизм работы:

1. `discover_domains()` находит `settings_class` в `DomainDescriptor`
2. `settings_registry.register(name, cls)` динамически создает `BaseSettings`-класс с префиксом
3. Pydantic загружает значения из `.env` и валидирует

```python
# app/core/settings_registry.py
def _load_from_env(name: str, cls: type[BaseModel]) -> BaseModel:
    # Для домена "reports" с ReportsSettings:
    # Создаёт временный BaseSettings с env_prefix="REPORTS__"
    # Загружает REPORTS__MAX_REPORT_SIZE_MB, REPORTS__DEFAULT_FORMAT
    loader_cls = type(
        f"_{name}_Loader",
        (BaseSettings,),
        {
            "__annotations__": cls.__annotations__.copy(),
            "model_config": SettingsConfigDict(
                env_prefix=f"{name.upper()}__",
                env_nested_delimiter="__",
                env_file=str(env_file),
            ),
        },
    )
    return cls.model_validate(loader_cls().model_dump())
```

**Использование в коде:**

```python
from app.core.settings_registry import get as get_domain_settings
settings = get_domain_settings("reports")
print(settings.max_report_size_mb)  # 50.0
```

### 5.5 Навигация (NavItem)

`NavItem` определяет элемент в боковой навигации (sidebar):

```python
@dataclass
class NavItem:
    label: str              # "Управление актами"
    url: str                # "/acts"
    icon_svg: str           # SVG-содержимое иконки
    order: int = 100        # сортировка (меньше = выше)
    active_page: str = ""   # для маркирования активной страницы
    chat_domains: list[str] # домены для фильтрации chat tools на странице
    group: str = ""         # группировка в sidebar
```

Все `nav_items` из всех доменов собираются и отображаются в sidebar через `get_nav_items_grouped()`.

### 5.6 Knowledge bases и chat_system_prompt

**Knowledge bases** — декларация баз знаний для AI-ассистента:

```python
KnowledgeBase(
    key="knowledge_base_oarb",      # ключ для localStorage
    label="База Знаний ОАРБ",       # отображаемое имя
    description="Поиск по базе...", # для toggle в UI
)
```

На текущий момент knowledge bases собираются на фронтенде (`ChatContext.getEnabledKnowledgeBases()`), но не передаются в API. Это место для будущей RAG-интеграции.

**`chat_system_prompt`** добавляется к базовому системному промпту при вызовах чата, если домен указан в фильтре `request.domains`.

### 5.7 Жизненный цикл домена

Опциональные хуки `on_startup` и `on_shutdown`:

```python
# _lifecycle.py
async def on_startup(app: FastAPI) -> None:
    """Вызывается при старте приложения."""
    # Инициализация ресурсов, ThreadPoolExecutor и т.д.

async def on_shutdown(app: FastAPI) -> None:
    """Вызывается при остановке."""
    # Очистка ресурсов
```

Домен `acts` использует `on_startup` для создания ThreadPoolExecutor (экспорт) и `on_shutdown` для его остановки.

### 5.8 Зависимости между доменами

Поле `dependencies` в `DomainDescriptor` определяет порядок инициализации. `discover_domains()` выполняет топологическую сортировку (алгоритм Кана):

```python
# Пример: acts зависит от admin (для справочника пользователей)
DomainDescriptor(
    name="acts",
    dependencies=["admin"],  # admin будет инициализирован первым
)
```

Циклические зависимости вызывают `RuntimeError` при старте.

---

## 6. База данных

### 6.1 Схема: основные и справочные таблицы

**Домен актов — 11 таблиц:**

| Таблица | Назначение | Связь |
|---------|-----------|-------|
| `acts` | Метаданные акта, блокировка | Главная |
| `audit_team_members` | Состав аудиторской группы | FK → acts, CASCADE |
| `act_directives` | Поручения (привязка к п.5) | FK → acts, CASCADE |
| `act_tree` | Иерархическая структура (JSONB) | FK → acts, CASCADE, UNIQUE |
| `act_tables` | Табличные данные (grid JSONB) | FK → acts, CASCADE |
| `act_textblocks` | Текстовые блоки с форматированием | FK → acts, CASCADE |
| `act_violations` | Карточки нарушений | FK → acts, CASCADE |
| `act_invoices` | Прикрепленные фактуры | FK → acts, CASCADE |
| `{REF_HADOOP_TABLES}` | Реестр таблиц Hadoop для поиска фактур | Справочная |
| `audit_log` | Журнал операций (JSONB details) | FK → acts, CASCADE |
| `act_content_versions` | Снимки содержимого для истории | FK → acts, CASCADE |

**Домен администрирования — 4 таблицы:**

| Таблица | Назначение |
|---------|-----------|
| `{REF_USER_TABLE}` | Справочник пользователей (ФИО, должность, подразделение) |
| `roles` | Справочник ролей (Админ, Цифровой акт, ЦК...) |
| `user_roles` | Связь пользователь → роль |
| `admin_audit_log` | Журнал действий администраторов (назначение/снятие ролей) |

**Домен ЦК Фин.Рез. (`ck_fin_res`) — 1 таблица:**

| Таблица | Назначение |
|---------|-----------|
| `t_db_oarb_ck_fr_validation` | Результаты верификации метрик FR (факты риска) |

Связанная таблица `t_db_oarb_ck_validation_reestr_metric` (реестр метрик, формат ФР00001) управляется ETL и в приложении не создаётся. VIEW `v_db_oarb_ck_fr_validation` (JOIN на `t_db_oarb_ua_sub_number` по `act_sub_number_id`) создаётся вне приложения средствами ETL/DBA.

**Домен ЦК Клиентский опыт (`ck_client_exp`) — 1 таблица:**

| Таблица | Назначение |
|---------|-----------|
| `t_db_oarb_ck_cs_validation` | Результаты верификации метрик CS (клиентский опыт) |

VIEW `v_db_oarb_ck_cs_validation` (JOIN на `t_db_oarb_ua_sub_number` по `km_id`) создаётся вне приложения средствами ETL/DBA.

**Домен справочных данных (`ua_data`) — 18 таблиц:**

Содержит словари и справочники, используемые другими доменами:

| Таблица | Назначение |
|---------|-----------|
| `t_db_oarb_ua_process_dict` | Словарь бизнес-процессов |
| `t_db_oarb_ua_terbank_dict` | Справочник территориальных банков |
| `t_db_oarb_ua_gosb_dict` | Справочник ГОСБ |
| `t_db_oarb_ua_vsp_dict` | Справочник ВСП |
| `t_db_oarb_ua_channel_dict` | Словарь каналов |
| `t_db_oarb_ua_product_dict` | Словарь продуктов |
| `t_db_oarb_ua_subsidiary_dict` | Словарь дочерних компаний |
| `t_db_oarb_ua_departments` | Справочник подразделений |
| `t_db_oarb_ua_violation_metric_dict` | Словарь метрик нарушений |
| `t_db_oarb_ua_team_dict` | Справочник команд |
| `t_db_oarb_ua_team_member_by_km` | Участники команд по КМ |
| `t_db_oarb_ua_sub_number` | Номера подактов (служебные записки) |
| `t_db_oarb_ua_violation_clients` | Клиенты нарушений |
| `t_db_oarb_ua_violation_facts` | Факты нарушений |
| `t_db_oarb_ua_violation_fr_metric` | Метрики нарушений FR |
| `t_db_oarb_ua_violation_cs_metric` | Метрики нарушений CS |
| `t_db_oarb_ua_violation_mkr_metric` | Метрики нарушений MKR |
| `t_db_oarb_ua_violation_ior_metric` | Метрики нарушений IOR |

**Справочные таблицы (из schema.sql домена актов):**

| Плейсхолдер | Назначение |
|-------------|-----------|
| `{REF_HADOOP_TABLES}` | Реестр таблиц Hadoop для поиска фактур |
| `{REF_METRIC_DICT}` | Словарь метрик для валидации |
| `{REF_PROCESS_DICT}` | Словарь процессов |
| `{REF_SUBSIDIARY_DICT}` | Словарь подразделений |

**Ключевые constraints таблицы `acts`:**

```sql
CONSTRAINT check_km_number_format
    CHECK (km_number ~ '^КМ-\d{2}-\d{5}$'),
CONSTRAINT check_km_number_digit_length
    CHECK (LENGTH(km_number_digit) = 7),
CONSTRAINT check_service_note_format
    CHECK (service_note IS NULL OR service_note ~ '^.+/\d{4}$'),
CONSTRAINT check_part_number_positive
    CHECK (part_number > 0),
CONSTRAINT check_total_parts_positive
    CHECK (total_parts > 0),
CONSTRAINT check_inspection_dates
    CHECK (inspection_end_date >= inspection_start_date),
CONSTRAINT check_service_note_consistency
    CHECK (service_note IS NULL OR sent_for_review = true),
UNIQUE(km_number_digit, part_number)
```

**Роли в `audit_team_members`:**

| Роль | Права |
|------|-------|
| Куратор | Управление доступом и метаданными |
| Руководитель | Изменение содержимого, аудит-лог |
| Редактор | Редактирование содержимого |
| Участник | Только просмотр |

### 6.2 Адаптеры (PostgreSQL vs Greenplum)

Абстрактный `DatabaseAdapter` (`app/db/adapters/base.py`) определяет интерфейс:

```python
class DatabaseAdapter(ABC):
    # Основные абстрактные методы
    @abstractmethod
    def get_table_name(self, base_name: str) -> str: ...
    @abstractmethod
    def qualify_table_name(self, name: str, schema: str = "") -> str: ...
    @abstractmethod
    def get_serial_type(self) -> str: ...
    @abstractmethod
    def get_index_strategy(self) -> str: ...
    @abstractmethod
    def supports_cascade_delete(self) -> bool: ...
    @abstractmethod
    def supports_on_conflict(self) -> bool: ...
    @abstractmethod
    def get_current_schema(self) -> str: ...

    # Методы создания таблиц
    @abstractmethod
    async def create_tables(self, conn, sql: str) -> None: ...
    @abstractmethod
    async def _get_existing_tables(self, conn) -> set[str]: ...

    # Статические утилиты
    @staticmethod
    def _extract_table_names_from_sql(sql: str) -> list[str]: ...
    @staticmethod
    def _split_sql_statements(sql: str) -> list[str]: ...

    # Конкретные методы
    def qualify_column(self, column: str, table: str) -> str: ...
```

**Сравнение реализаций:**

| Аспект | PostgreSQL | Greenplum |
|--------|-----------|-----------|
| Имена таблиц | `acts` | `{SCHEMA}.{PREFIX}acts` |
| Auto-increment | `SERIAL` | `BIGSERIAL` |
| CASCADE DELETE | Да | Нет (ручное управление) |
| ON CONFLICT | Да | Нет (DELETE + INSERT) |
| Индексы | GIN на JSONB | BTREE |
| Аутентификация | Пароль | Kerberos (kinit) |

**Greenplum adapter** использует плейсхолдеры `{SCHEMA}` и `{PREFIX}` в schema.sql, которые подставляются при создании таблиц:

```python
class GreenplumAdapter(DatabaseAdapter):
    def __init__(self, schema: str, table_prefix: str):
        self.schema = schema              # s_grnplm_ld_audit_da_project_4
        self.table_prefix = table_prefix  # t_db_oarb_audit_act_

    def get_table_name(self, base_name: str) -> str:
        return f"{self.schema}.{self.table_prefix}{base_name}"
        # → s_grnplm_ld_audit_da_project_4.t_db_oarb_audit_act_acts
```

### 6.3 Пул подключений (asyncpg)

Файл `app/db/connection.py` управляет пулом подключений:

```python
async def init_db(settings: Settings) -> None:
    """Инициализирует пул и адаптер по типу БД."""
    if settings.database.type == "postgresql":
        _adapter = PostgreSQLAdapter()
        pool_kwargs = {
            "host": settings.database.host,
            "port": settings.database.port,
            "database": settings.database.name,
            "user": settings.database.user,
            "password": settings.database.password,
        }
    elif settings.database.type == "greenplum":
        _adapter = GreenplumAdapter(...)
        # username из JUPYTERHUB_USER

    _pool = await asyncpg.create_pool(
        **pool_kwargs,
        min_size=settings.database.pool_min_size,
        max_size=settings.database.pool_max_size,
        command_timeout=settings.database.command_timeout,
    )

@asynccontextmanager
async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """Получить соединение из пула (для FastAPI Depends)."""
    pool = get_pool()
    async with pool.acquire() as connection:
        yield connection
```

**Ключевые функции:**
- `get_pool()` — текущий пул
- `get_adapter()` — текущий адаптер
- `init_db(settings)` — инициализация при старте
- `close_db()` — закрытие при shutdown
- `create_tables_if_not_exist(domains)` — автосоздание таблиц

### 6.4 BaseRepository: паттерн работы с БД

```python
# app/db/repositories/base.py
class BaseRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn
        self.adapter = get_adapter()
```

**Использование в доменных репозиториях:**

```python
class ActCrudRepository(BaseRepository):
    def __init__(self, conn: asyncpg.Connection):
        super().__init__(conn)
        self.acts = self.adapter.get_table_name("acts")

    async def get_act_by_id(self, act_id: int) -> dict | None:
        return await self.conn.fetchrow(
            f"SELECT * FROM {self.acts} WHERE id = $1",
            act_id,
        )
```

Имена таблиц всегда получаются через `self.adapter.get_table_name()` — это обеспечивает работу с обеими СУБД.

### 6.5 Миграции

SQL-схемы хранятся в каждом домене:

```
app/domains/<name>/migrations/
├── postgresql/schema.sql
└── greenplum/schema.sql
```

Таблицы создаются автоматически при старте приложения через `create_tables_if_not_exist(domains)`. Каждый `schema.sql` содержит `CREATE TABLE IF NOT EXISTS`, поэтому повторный запуск безопасен.

Для Greenplum используются плейсхолдеры `{SCHEMA}`, `{PREFIX}`, `{REF_*}`, которые подставляются адаптером из `migration_substitutions` домена.

### 6.6 JSON/JSONB утилиты

Файл `app/db/utils/json_db_utils.py` содержит утилиты для конвертации JSON/JSONB данных из asyncpg в Python dict. Asyncpg возвращает JSON-поля как строки — утилиты автоматически парсят их.

### 6.7 Пример: добавление новой таблицы

**Шаг 1.** Добавить SQL в `app/domains/acts/migrations/postgresql/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS act_attachments (
    id BIGSERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Шаг 2.** Добавить аналог для Greenplum в `greenplum/schema.sql` (с плейсхолдерами).

**Шаг 3.** Создать репозиторий:

```python
# app/domains/acts/repositories/act_attachment.py
class ActAttachmentRepository(BaseRepository):
    def __init__(self, conn):
        super().__init__(conn)
        self.table = self.adapter.get_table_name("act_attachments")

    async def save(self, act_id: int, filename: str, path: str, username: str):
        await self.conn.execute(
            f"INSERT INTO {self.table} (act_id, filename, file_path, uploaded_by) "
            f"VALUES ($1, $2, $3, $4)",
            act_id, filename, path, username,
        )
```

**Шаг 4.** Перезапустить приложение — таблица создастся автоматически.

---

## 7. AI-ассистент

### 7.1 Архитектура: chat domain

AI-ассистент реализован как доменный плагин `app/domains/chat/` с SSE-стримингом и agent loop:

```
Клиент → POST /api/v1/chat/conversations/{id}/messages (FormData)
    ↓
Сохранение user message в БД (chat_messages)
    ↓
Orchestrator.run_stream() / run()
    ↓
Загрузка истории из БД (max_history_length)
    ↓
Построение messages (system + доменные промпты + history + user)
    ↓
LLM вызов (OpenAI-compatible API, streaming или full)
    ↓
Если tool_calls:
    ├── Выполнить каждый tool call (с timeout)
    ├── Добавить результаты в messages
    └── Повторный LLM вызов (до max_tool_rounds)
    ↓
SSE-события клиенту (message_start, block_delta, tool_call, tool_result, ...)
    ↓
Сохранение assistant message в БД
```

**API эндпоинты** (`app/domains/chat/api/`):
- `POST /conversations` — создать разговор
- `GET /conversations` — список (с фильтром по домену)
- `GET /conversations/{id}` — получить разговор
- `PATCH /conversations/{id}` — обновить заголовок
- `DELETE /conversations/{id}` — удалить (каскадно: messages, files)
- `POST /conversations/{id}/messages` — отправить сообщение (SSE или JSON по Accept)
- `GET /conversations/{id}/messages` — история сообщений
- `GET /files/{file_id}` — скачать файл
- `POST /actions/{action_id}` — выполнить action button

**Сервисы домена чата** (`app/domains/chat/services/`):

| Сервис | Файл | Назначение |
|--------|------|-----------|
| `ConversationService` | `conversation_service.py` | CRUD разговоров, фильтрация по домену |
| `MessageService` | `message_service.py` | Сохранение и загрузка сообщений |
| `FileService` | `file_service.py` | Загрузка, хранение и отдача файлов |
| `FileExtraction` | `file_extraction.py` | Извлечение текстового содержимого из файлов |
| `ActionService` | `action_service.py` | Выполнение действий (action buttons в чате) |
| `Orchestrator` | `orchestrator.py` | Agent loop: LLM → tool_calls → повтор (см. [7.4](#74-agent-loop)) |
| SSE-утилиты | `streaming.py` | Форматирование SSE-событий |

**Persistence:** 3 таблицы БД (`chat_conversations`, `chat_messages`, `chat_files`).

**SSE-события** (`app/domains/chat/services/streaming.py`):
`message_start`, `block_start`, `block_delta`, `block_end`, `tool_call`, `tool_result`, `plan_update`, `buttons`, `message_end`, `error`.

**Блоки сообщений** (`app/core/chat/blocks.py`):
`TextBlock`, `CodeBlock`, `ReasoningBlock`, `PlanBlock`, `FileBlock`, `ImageBlock`, `ButtonGroup`.

**Доменные исключения** (`app/domains/chat/exceptions.py`):
`ConversationNotFoundError`, `ChatFileNotFoundError`, `ActionNotFoundError`, `ChatLimitError`, `ChatFileValidationError`.

### 7.2 ChatTool и ChatToolParam

Инструменты определяются через dataclass-ы в `app/core/chat/tools.py`:

```python
@dataclass(frozen=True)
class ChatToolParam:
    name: str              # имя параметра
    type: str              # "string", "integer", "boolean", "array", "object", "date"
    description: str       # описание на русском
    required: bool = True
    default: Any = None
    enum: list[str] | None = None
    items_type: str = "string"  # тип элементов для type="array"

@dataclass(frozen=True)
class ChatTool:
    name: str              # "acts.search_acts"
    domain: str            # "acts"
    description: str       # описание на русском
    parameters: list[ChatToolParam] = field(default_factory=list)
    handler: Callable | None = None  # async функция
    category: str = ""     # "search", "extract"

    def to_openai_tool(self) -> dict:
        """Конвертация в OpenAI function-calling формат."""
        # → {"type": "function", "function": {"name": ..., "parameters": ...}}
```

### 7.3 Реестр chat tools

Глобальный реестр в `app/core/chat/tools.py`:

```python
_tools: dict[str, ChatTool] = {}

def register_tools(tools: list[ChatTool]) -> None:
    for tool in tools:
        if tool.name in _tools:
            raise RuntimeError(f"ChatTool '{tool.name}' уже зарегистрирован")
        _tools[tool.name] = tool

def get_tool(name: str) -> ChatTool | None:
    return _tools.get(name)

def get_all_tools() -> list[ChatTool]:
    return list(_tools.values())

def get_tools_by_domain(domain: str) -> list[ChatTool]:
    return [t for t in _tools.values() if t.domain == domain]

def get_openai_tools(domains: list[str] | None = None) -> list[dict]:
    """Все инструменты в OpenAI function-calling формате (с фильтром по доменам)."""

def reset() -> None:
    """Для тестов: очистить реестр."""
    _tools.clear()
```

Инструменты регистрируются автоматически при обнаружении домена через `discover_domains()`.

**Домен актов определяет 27 инструментов** в 2 категориях:

| Категория | Кол-во | Примеры |
|-----------|--------|---------|
| `search` | 1 | `acts.search_acts` |
| `extract` | 26 | `acts.get_act_by_km`, `acts.get_act_structure`, `acts.get_item_by_number`, `acts.get_all_violations`, `acts.get_all_tables`, `acts.get_all_textblocks`, `acts.get_all_invoices` |

Все extract-инструменты покрывают: полное содержимое актов, структуру дерева, пункты по номеру, нарушения и поля, таблицы, текстовые блоки, фактуры.

### 7.4 Agent loop

Реализация в `app/domains/chat/services/orchestrator.py` (класс `Orchestrator`):

```python
# Orchestrator получает настройки через DI (ChatDomainSettings)
orchestrator = Orchestrator(settings, conv_service, msg_service, file_service)

# run_stream() — SSE стриминг (основной режим)
async for event in orchestrator.run_stream(conversation_id, message, files, domains):
    yield format_sse(event)

# run() — JSON ответ (альтернативный режим)
result = await orchestrator.run(conversation_id, message, files, domains)
```

**Внутренний цикл:**
1. Загрузка истории из БД (`self._get_history_messages(conversation_id)`)
2. Построение system prompt (`self._build_system_messages(domains)`)
3. LLM вызов (`self.settings.model`, `self.settings.temperature`)
4. Если `tool_calls` → выполнение через `self._execute_tool_call()` → повторный LLM вызов
5. Повтор до `max_tool_rounds` (по умолчанию 5)
6. Сохранение assistant message в БД

**Выполнение tool call** (`_execute_tool_call`):
- Конвертация типов параметров (`"boolean"` → bool, `"integer"` → int, `"date"` → date)
- Таймаут на каждый инструмент (по умолчанию 30 сек, `asyncio.wait_for`)
- Результаты dict → JSON, остальное → str

**Fallback:** если API не настроен (пустой `CHAT__API_BASE`), возвращается заглушка с инструкциями.

### 7.5 Knowledge bases

`KnowledgeBase` определяется в `DomainDescriptor` и отображается в UI как toggle в настройках:

```python
KnowledgeBase(
    key="knowledge_base_oarb",
    label="База Знаний ОАРБ",
    description="Поиск по базе знаний ОАРБ",
)
```

Клиент собирает выбранные базы знаний на фронтенде (`ChatContext.getEnabledKnowledgeBases()`), но текущий API не принимает их в запросе. Это место для будущей RAG-интеграции.

### 7.6 Пример: добавление нового chat tool

**Шаг 1.** Создать handler:

```python
# app/domains/reports/integrations/ai_assistant/export_reports.py
async def get_report_summary(report_id: int) -> str:
    """Получает краткое содержание отчета."""
    # ... логика
    return json.dumps(result, ensure_ascii=False)
```

**Шаг 2.** Экспортировать из `__init__.py`:

```python
# app/domains/reports/integrations/ai_assistant/__init__.py
from .export_reports import get_report_summary
__all__ = ["get_report_summary"]
```

**Шаг 3.** Определить ChatTool:

```python
# app/domains/reports/integrations/chat_tools.py
def get_chat_tools() -> list[ChatTool]:
    from app.domains.reports.integrations.ai_assistant import get_report_summary
    return [
        ChatTool(
            name="reports.get_report_summary",
            domain="reports",
            description="Получает краткое содержание отчета по его ID.",
            parameters=[
                ChatToolParam("report_id", "integer", "ID отчета"),
            ],
            handler=get_report_summary,
            category="extract",
        ),
    ]
```

**Шаг 4.** Зарегистрировать в DomainDescriptor:

```python
# app/domains/reports/__init__.py
def _build_domain():
    from app.domains.reports.integrations.chat_tools import get_chat_tools
    return DomainDescriptor(
        ...,
        chat_tools=get_chat_tools(),
    )
```

**Шаг 5.** Написать тест (см. [раздел 8](#8-тестирование)).

**Пример реальной структуры: `acts/integrations/ai_assistant/`**

Домен актов реализует развитую структуру AI-интеграции:

```
app/domains/acts/integrations/
├── chat_tools.py                    — определения 27 ChatTool
└── ai_assistant/
    ├── _helpers.py                  — общие утилиты для экспортов
    ├── export_acts.py               — полное содержимое актов
    ├── export_invoices.py           — данные фактур
    ├── export_items.py              — пункты по номеру
    ├── export_search.py             — поиск актов
    ├── export_structure.py          — структура дерева
    ├── export_tables.py             — табличные данные
    ├── export_textblocks.py         — текстовые блоки
    ├── export_violations.py         — карточки нарушений
    ├── formatters/
    │   └── ai_readable_formatter.py — форматирование для AI-контекста
    └── queries/
        ├── act_filters.py           — фильтрация запросов
        └── act_queries.py           — SQL-запросы для извлечения данных
```

Каждый `export_*.py` содержит async-функцию, которая используется как `handler` в `ChatTool`. Функция получает соединение из пула, выполняет SQL через `act_queries.py` и форматирует результат через `ai_readable_formatter.py`.

### 7.7 Фронтенд: event-driven архитектура чата

Фронтенд чата построен на event-driven архитектуре из 6 модулей, связанных через шину событий `ChatEventBus`. Три режима чата (inline на landing, modal в portal, popup в constructor) используют единый набор модулей.

**Граф зависимостей:**

```
ChatEventBus          — шина событий (pub/sub, синхронная)
    ↑
ChatUI                — typing-индикатор, блокировка ввода, scroll, авторесайз
ChatFiles             — валидация файлов, drag-drop, превью, лимиты
ChatContext           — управление беседами, knowledge bases, домены
ChatMessages          — отправка через SSE, обработка SSE-событий, рендеринг сообщений
    ↑
ChatManager           — тонкий фасад: инициализирует модули, делегирует через EventBus
    ↑
ChatModalManager      — модальное окно (portal)
ChatPopupManager      — popup окно (constructor)
```

**Карта событий:**

| Событие | Отправитель | Подписчики |
|---------|-------------|------------|
| `chat:send-request` | ChatManager | ChatMessages |
| `chat:clear` | ChatManager | ChatMessages, ChatContext |
| `ui:processing` | ChatMessages | ChatUI |
| `ui:typing-show` | ChatMessages | ChatUI |
| `ui:typing-hide` | ChatMessages | ChatUI |
| `ui:scroll-bottom` | ChatMessages | ChatUI |
| `context:conversation-switched` | ChatContext | ChatMessages, ChatFiles |
| `context:conversation-cleared` | ChatContext | ChatMessages, ChatFiles |
| `files:changed` | ChatFiles | (extension point) |
| `files:cleared` | ChatFiles | (extension point) |

**Порядок загрузки скриптов** (в `base_portal.html` и `base_constructor.html`):

```
chat-stream.js → chat-renderer.js → chat-history.js →
chat-event-bus.js → chat-ui.js → chat-files.js →
chat-context.js → chat-messages.js → chat-manager.js →
chat-modal.js / chat-popup.js
```

**Ключевые паттерны:**

- **Защита от повторной инициализации**: каждый модуль хранит `_initialized` флаг и выходит из `init()` при повторном вызове (arrow-функции в `Set` не дедуплицируются)
- **Ленивая инициализация**: `ChatModalManager`/`ChatPopupManager` вызывают `ChatManager.init()` при первом открытии
- **Публичный API фасада**: `ChatManager.init()`, `.sendMessage()`, `.sendQuickReply(value)`, `.executeAction(actionId, params)`, `.clearChat()` — обратная совместимость для всех точек интеграции
- **Прямой fetch в executeAction**: actions используют отдельный API endpoint без SSE, поэтому не идут через event bus

---

## 8. Тестирование

### 8.1 Стек и структура

| Инструмент | Версия | Назначение |
|-----------|--------|-----------|
| pytest | — | Фреймворк тестирования |
| pytest-asyncio | — | Поддержка async тестов |
| httpx / TestClient | — | Тестирование HTTP API |
| unittest.mock | — | Моки и патчи |

```
tests/
├── conftest.py                       — общие фикстуры (mock_conn, mock_adapter)
├── test_chat_tools.py                — тесты ChatTool реестра
├── test_domain_registry.py           — тесты domain_registry
├── test_settings_registry.py         — тесты settings_registry
├── test_settings_env_parsing.py      — тесты парсинга переменных окружения
├── test_auth_deps.py                 — тесты авторизации
├── test_km_utils.py                  — тесты KM-утилит
├── test_middleware.py                — тесты middleware
├── test_act_tree_utils.py            — тесты утилит дерева актов
├── test_directives_validator.py      — тесты валидации поручений
├── test_access_guard.py              — тесты AccessGuard
├── test_exceptions.py                — тесты исключений
├── test_schemas.py                   — тесты Pydantic-схем актов
├── test_admin_schemas.py             — тесты схем администрирования
├── test_admin_service.py             — тесты AdminService
├── test_db_utils.py                  — тесты JSON/SQL утилит БД
├── test_db_adapters.py               — тесты адаптеров PostgreSQL/Greenplum
├── test_connection.py                — тесты пула подключений
├── test_navigation.py                — тесты навигации (NavItem, sidebar)
├── test_gp_compatibility.py          — тесты совместимости с Greenplum
├── core/
│   ├── test_chat_blocks.py           — тесты блоков сообщений
│   └── test_chat_buttons.py          — тесты action button реестра
├── domains/
│   ├── acts/
│   │   └── test_restructure_tree.py  — тесты реструктуризации дерева
│   └── chat/
│       ├── test_chat_services.py     — тесты сервисов чата
│       ├── test_chat_integration.py  — интеграционные тесты чата
│       ├── test_chat_orchestrator.py — тесты Orchestrator (agent loop)
│       ├── test_chat_streaming.py    — тесты SSE-стриминга
│       ├── test_chat_file_extraction.py — тесты извлечения текста из файлов
│       ├── test_chat_security.py     — тесты безопасности чата
│       └── test_chat_race_conditions.py — тесты race conditions
├── test_admin/
│   ├── test_admin_audit_log.py       — тесты аудит-лога администрирования
│   ├── test_admin_repository.py      — тесты репозитория admin
│   └── test_admin_service.py         — тесты AdminService (расширенные)
├── test_ck_fin_res/
│   ├── test_fr_repository.py         — тесты репозитория ЦК ФинРез
│   ├── test_fr_schemas.py            — тесты схем ЦК ФинРез
│   └── test_fr_service.py            — тесты сервиса ЦК ФинРез
├── test_ck_client_exp/
│   ├── test_cs_repository.py         — тесты репозитория ЦК КлОпыт
│   ├── test_cs_schemas.py            — тесты схем ЦК КлОпыт
│   └── test_cs_service.py            — тесты сервиса ЦК КлОпыт
└── test_ua_data/
    └── test_dictionary_repository.py — тесты репозитория справочников
```

### 8.2 Фикстуры: сброс реестров

Доменная система использует глобальное состояние. Между тестами его нужно сбрасывать. Каждый тест-файл определяет свою `autouse`-фикстуру, сбрасывающую только используемые реестры:

```python
# Пример: в тест-файле chat tools
from app.core.chat.tools import reset as reset_chat_tools

@pytest.fixture(autouse=True)
def clean():
    reset_chat_tools()
    yield
    reset_chat_tools()
```

Доступные функции сброса:
- `domain_registry.reset_registry()` — для тестов доменов
- `settings_registry.reset()` — для тестов настроек
- `app.core.chat.tools.reset()` — для тестов chat tools

Общие фикстуры в `tests/conftest.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_conn():
    """Mock asyncpg.Connection."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock()
    conn.fetchval = AsyncMock()
    conn.fetch = AsyncMock()
    conn.execute = AsyncMock()
    conn.executemany = AsyncMock()
    # Transaction context manager
    conn.transaction.return_value.__aenter__ = AsyncMock()
    conn.transaction.return_value.__aexit__ = AsyncMock()
    return conn

@pytest.fixture
def mock_adapter():
    """Mock DatabaseAdapter."""
    adapter = MagicMock()
    adapter.get_table_name = lambda name: name
    adapter.qualify_table_name = lambda name, schema="": name
    adapter.supports_on_conflict.return_value = True
    return adapter
```

### 8.3 Тестирование API

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/api/v1/system/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"

def test_chat_fallback():
    """Тест chat endpoint при отсутствии LLM API."""
    # 1. Создать разговор
    conv = client.post("/api/v1/chat/conversations", json={})
    conversation_id = conv.json()["id"]
    # 2. Отправить сообщение (FormData)
    response = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        data={"message": "Привет", "domains": "acts"},
    )
    assert response.status_code == 200
```

### 8.4 Тестирование сервисов и репозиториев

```python
import pytest
from app.domains.acts.services.act_crud_service import ActCrudService

@pytest.mark.asyncio
async def test_list_acts(mock_conn):
    mock_conn.fetch.return_value = [
        {"id": 1, "km_number": "КМ-12-12345", "inspection_name": "Тест"}
    ]

    service = ActCrudService(conn=mock_conn, settings=MagicMock())
    result = await service.list_acts("test_user")

    assert len(result) == 1
    mock_conn.fetch.assert_called_once()
```

**Тестирование ChatTool реестра:**

```python
from app.core.chat.tools import ChatTool, ChatToolParam, register_tools, get_tool, reset

@pytest.fixture(autouse=True)
def clean():
    reset()
    yield
    reset()

def test_register_and_get():
    tool = ChatTool(name="test_tool", domain="test", description="desc")
    register_tools([tool])
    assert get_tool("test_tool") is tool

def test_duplicate_raises():
    register_tools([ChatTool(name="dup", domain="a", description="x")])
    with pytest.raises(RuntimeError, match="уже зарегистрирован"):
        register_tools([ChatTool(name="dup", domain="b", description="y")])
```

### 8.5 Пример: тест для нового эндпоинта

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient

def test_get_act_status():
    """Тест получения статуса акта."""
    mock_service = AsyncMock()
    mock_service.get_act.return_value = MagicMock(
        id=1, locked_by="user1"
    )

    with patch("app.domains.acts.deps.get_crud_service", return_value=mock_service):
        with patch("app.api.v1.deps.auth_deps.get_username", return_value="test_user"):
            from app.main import app
            client = TestClient(app)
            response = client.get("/api/v1/acts/1/status")

            assert response.status_code == 200
            data = response.json()
            assert data["act_id"] == 1
            assert data["locked"] is True
```

---

## 9. Деплой и инфраструктура

### 9.1 Standalone (uvicorn)

Для локальной разработки:

```bash
# Способ 1: запуск как модуль (горячая перезагрузка)
python -m app.main

# Способ 2: uvicorn напрямую
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Для production (без перезагрузки, несколько воркеров):

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4
```

### 9.2 За JupyterHub proxy

При работе в DataLab приложение находится за JupyterHub proxy. Конфигурация автоматическая:

```python
# main.py
root_path = ''
if settings.database.type == 'greenplum':
    root_path = f"/user/{get_current_user_from_env(truncate=False)}/proxy/{settings.server.port}"
```

Все пути автоматически префиксируются: `/user/{user}/proxy/{port}/api/v1/acts`.

**Требуется Kerberos:**

```bash
kinit            # ввести пароль
python -m app.main
```

**.env для DataLab:**

```env
DATABASE__TYPE=greenplum
DATABASE__GP__HOST=gp_dns_pkap1123_audit.gp.df.sbrf.ru
DATABASE__GP__PORT=5432
DATABASE__GP__DATABASE=capgp3
DATABASE__GP__SCHEMA=s_grnplm_ld_audit_da_project_4
DATABASE__GP__TABLE_PREFIX=t_db_oarb_audit_act_
SERVER__HOST=0.0.0.0
SERVER__PORT=8000
```

### 9.3 За reverse proxy (HTTPS)

`HTTPSRedirectMiddleware` автоматически переписывает схему при наличии заголовков `x-forwarded-proto` или `x-scheme`.

**Nginx конфигурация:**

```nginx
server {
    listen 443 ssl http2;
    server_name audit.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;  # для HTTPSRedirectMiddleware
        proxy_set_header X-Scheme https;
        proxy_buffering off;
    }
}
```

### 9.4 Конфигурация: .env и Pydantic Settings

Конфигурация управляется через `.env` файл и загружается Pydantic Settings (`app/core/config.py`).

**Иерархия настроек:**

```
Settings (BaseSettings) — корневой, загружается из .env
├── server: ServerSettings (BaseModel)
├── database: DatabaseSettings (BaseModel)
│   └── gp: GreenplumSettings (BaseModel)
└── security: SecuritySettings (BaseModel)

+ Доменные настройки (через settings_registry):
ChatDomainSettings (BaseModel) — префикс CHAT__ (app/domains/chat/settings.py)
ActsSettings (BaseModel) — префикс ACTS__
├── lock: LockSettings
├── formatting: FormattingSettings
├── resource: ResourceSettings
├── invoice: InvoiceSettings
└── audit_log: AuditLogSettings
```

**Правила:**
- Корневой `Settings` — единственный `BaseSettings`; вложенные модели — `BaseModel`
- Разделитель для вложенных полей: `__` (например, `DATABASE__HOST`)
- Регистронезависимые переменные окружения
- Неизвестные переменные игнорируются (`extra="ignore"`)
- Поле `schema_name` в GreenplumSettings использует `alias="schema"` (в .env: `DATABASE__GP__SCHEMA`)

**Использование:**

```python
from app.core.config import get_settings
settings = get_settings()

settings.app_title                    # "Audit Workstation"
settings.database.type                # "postgresql"
settings.server.host                  # "0.0.0.0"
settings.security.max_request_size    # 10485760
# Доменные настройки чата (через settings_registry)
from app.core.settings_registry import get as get_domain_settings
from app.domains.chat.settings import ChatDomainSettings
chat_settings = get_domain_settings("chat", ChatDomainSettings)
chat_settings.api_key.get_secret_value()  # безопасное получение ключа
```

**Пример .env:**

```env
APP_TITLE=Audit Workstation
APP_VERSION=1.0.0
JUPYTERHUB_USER=00000000_omega-sbrf-ru

SERVER__HOST=0.0.0.0
SERVER__PORT=8000
SERVER__LOG_LEVEL=INFO

DATABASE__TYPE=postgresql
DATABASE__HOST=localhost
DATABASE__PORT=5432
DATABASE__NAME=audit_workstation
DATABASE__USER=postgres
DATABASE__PASSWORD=secret_password

SECURITY__MAX_REQUEST_SIZE=10485760
SECURITY__RATE_LIMIT_PER_MINUTE=1024

# AI-чат (опционально)
# CHAT__API_BASE=https://api.openai.com/v1
# CHAT__API_KEY=sk-...

ACTS__LOCK__DURATION_MINUTES=15
ACTS__LOCK__INACTIVITY_TIMEOUT_MINUTES=5
ACTS__FORMATTING__DOCX_IMAGE_WIDTH=4.0
ACTS__RESOURCE__MAX_TREE_DEPTH=50
ACTS__AUDIT_LOG__RETENTION_DAYS=365
```

### 9.5 Полная таблица переменных окружения

| Группа | Переменная | Тип | По умолчанию | Описание |
|--------|-----------|-----|-------------|----------|
| **Метаданные** | `APP_TITLE` | str | `Audit Workstation` | Название приложения |
| | `APP_VERSION` | str | `1.0.0` | Версия |
| | `JUPYTERHUB_USER` | str | `unknown_user` | Пользователь DataLab |
| **Сервер** | `SERVER__HOST` | str | `0.0.0.0` | IP для привязки |
| | `SERVER__PORT` | int | `8000` | TCP порт (1-65535) |
| | `SERVER__API_V1_PREFIX` | str | `/api/v1` | Префикс API |
| | `SERVER__LOG_LEVEL` | str | `INFO` | Уровень логирования |
| **БД: Выбор** | `DATABASE__TYPE` | str | `postgresql` | `postgresql` или `greenplum` |
| **БД: Основные** | `DATABASE__HOST` | str | `localhost` | Хост |
| | `DATABASE__PORT` | int | `5432` | Порт |
| | `DATABASE__NAME` | str | `audit_workstation` | Имя БД |
| | `DATABASE__USER` | str | `postgres` | Пользователь |
| | `DATABASE__PASSWORD` | str | (пусто) | Пароль |
| **БД: Пул** | `DATABASE__POOL_MIN_SIZE` | int | `2` | Мин. соединений |
| | `DATABASE__POOL_MAX_SIZE` | int | `10` | Макс. соединений |
| | `DATABASE__COMMAND_TIMEOUT` | int | `60` | Timeout команд (сек) |
| **БД: Greenplum** | `DATABASE__GP__HOST` | str | `gp_dns_...` | Хост GP |
| | `DATABASE__GP__PORT` | int | `5432` | Порт GP |
| | `DATABASE__GP__DATABASE` | str | `capgp3` | Имя БД GP |
| | `DATABASE__GP__SCHEMA` | str | `s_grnplm_...` | Схема GP |
| | `DATABASE__GP__TABLE_PREFIX` | str | `t_db_oarb_audit_act_` | Префикс таблиц |
| **Безопасность** | `SECURITY__MAX_REQUEST_SIZE` | int | `10485760` | Макс. размер запроса (байт) |
| | `SECURITY__RATE_LIMIT_PER_MINUTE` | int | `1024` | Лимит запросов/мин на IP |
| | `SECURITY__MAX_TRACKED_IPS` | int | `100` | Макс. отслеживаемых IP |
| | `SECURITY__RATE_LIMIT_TTL` | int | `120` | TTL метрик (сек) |
| **Чат** (доменные) | `CHAT__API_BASE` | str | (пусто) | Базовый URL LLM API |
| | `CHAT__API_KEY` | SecretStr | (пусто) | API-ключ |
| | `CHAT__MODEL` | str | `gpt-4o` | Модель |
| | `CHAT__TEMPERATURE` | float | `0.1` | Температура (0-2) |
| | `CHAT__MAX_TOOL_ROUNDS` | int | `5` | Макс. раундов tool-calling |
| | `CHAT__STREAMING_ENABLED` | bool | `True` | SSE-стриминг ответов |
| | `CHAT__TOOL_EXECUTION_TIMEOUT` | int | `30` | Timeout инструмента (сек) |
| | `CHAT__SYSTEM_PROMPT` | str | `Ты — AI-ассистент...` | Системный промпт |
| | `CHAT__MAX_HISTORY_LENGTH` | int | `50` | Макс. сообщений в истории |
| | `CHAT__MAX_MESSAGE_CONTENT_LENGTH` | int | `10000` | Макс. длина сообщения |
| | `CHAT__MAX_FILE_SIZE` | int | `10485760` | Макс. размер файла (байт) |
| | `CHAT__MAX_FILES_PER_MESSAGE` | int | `5` | Макс. файлов в сообщении |
| | `CHAT__MAX_CONVERSATIONS_PER_USER` | int | `100` | Макс. разговоров на пользователя |
| | `CHAT__MAX_MESSAGES_PER_CONVERSATION` | int | `500` | Макс. сообщений в разговоре |
| **Акты: Блокировки** | `ACTS__LOCK__DURATION_MINUTES` | int | `15` | Длительность блокировки |
| | `ACTS__LOCK__INACTIVITY_TIMEOUT_MINUTES` | float | `5.0` | Timeout неактивности |
| | `ACTS__LOCK__INACTIVITY_CHECK_INTERVAL_SECONDS` | int | `60` | Интервал проверки |
| | `ACTS__LOCK__MIN_EXTENSION_INTERVAL_MINUTES` | float | `5.0` | Мин. интервал продления |
| | `ACTS__LOCK__INACTIVITY_DIALOG_TIMEOUT_SECONDS` | int | `30` | Timeout диалога |
| **Акты: Форматирование** | `ACTS__FORMATTING__MAX_IMAGE_SIZE_MB` | float | `10.0` | Макс. размер изображения |
| | `ACTS__FORMATTING__DOCX_IMAGE_WIDTH` | float | `4.0` | Ширина изображения (дюймы) |
| | `ACTS__FORMATTING__DOCX_CAPTION_FONT_SIZE` | int | `10` | Размер шрифта подписей |
| | `ACTS__FORMATTING__DOCX_MAX_HEADING_LEVEL` | int | `9` | Макс. уровень заголовков |
| | `ACTS__FORMATTING__TEXT_HEADER_WIDTH` | int | `80` | Ширина заголовка |
| | `ACTS__FORMATTING__TEXT_INDENT_SIZE` | int | `2` | Отступ в тексте |
| | `ACTS__FORMATTING__MARKDOWN_MAX_HEADING_LEVEL` | int | `6` | Макс. уровень в MD |
| | `ACTS__FORMATTING__HTML_PARSE_TIMEOUT` | int | `30` | Timeout парсинга HTML |
| | `ACTS__FORMATTING__MAX_HTML_DEPTH` | int | `100` | Макс. глубина HTML |
| | `ACTS__FORMATTING__HTML_PARSE_CHUNK_SIZE` | int | `1000` | Размер чанка |
| | `ACTS__FORMATTING__MAX_RETRIES` | int | `3` | Макс. попыток |
| | `ACTS__FORMATTING__RETRY_DELAY` | float | `0.5` | Задержка retry |
| **Акты: Ресурсы** | `ACTS__RESOURCE__MAX_CONCURRENT_FILE_OPERATIONS` | int | `100` | Макс. файловых операций |
| | `ACTS__RESOURCE__SAVE_OPERATION_TIMEOUT` | int | `300` | Timeout сохранения |
| | `ACTS__RESOURCE__SAVE_ACT_TIMEOUT` | int | `300` | Timeout сохранения акта |
| | `ACTS__RESOURCE__MAX_TREE_DEPTH` | int | `50` | Макс. глубина дерева |
| **Акты: Фактуры** | `ACTS__INVOICE__HIVE_SCHEMA` | str | `team_sva_oarb_3` | Hive-схема |
| | `ACTS__INVOICE__GP_SCHEMA` | str | `s_grnplm_...` | GP-схема |
| | `ACTS__INVOICE__HIVE_REGISTRY_SCHEMA` | str | `s_grnplm_...` | Реестр Hive |
| | `ACTS__INVOICE__HIVE_REGISTRY_TABLE` | str | `t_db_oarb_ua_hadoop_tables` | Таблица реестра Hive |
| **Акты: Аудит-лог** | `ACTS__AUDIT_LOG__RETENTION_DAYS` | int | `365` | Дни хранения лога |
| | `ACTS__AUDIT_LOG__MAX_CONTENT_VERSIONS` | int | `50` | Макс. версий содержимого |
| | `ACTS__AUDIT_LOG__MAX_DIFF_ELEMENTS` | int | `20` | Макс. элементов в diff |
| | `ACTS__AUDIT_LOG__MAX_DIFF_CELLS_PER_TABLE` | int | `50` | Макс. ячеек diff на таблицу |
| **Администрирование** | `ADMIN__USER_DIRECTORY__SCHEMA` | str | `""` | Схема справочника (пустая — основная GP) |
| | `ADMIN__USER_DIRECTORY__TABLE` | str | `t_db_oarb_ua_user` | Таблица пользователей |
| | `ADMIN__USER_DIRECTORY__BRANCH_FILTER` | str | `Отдел аудита...` | Фильтр отделения |
| | `ADMIN__USER_DIRECTORY__DEFAULT_ADMIN` | str | `22494524` | Админ по умолчанию |
