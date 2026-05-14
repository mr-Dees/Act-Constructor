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
  - [6.8 Добавление UA-справочника](#68-добавление-ua-справочника)
- [7. AI-ассистент](#7-ai-ассистент)
  - [7.1 Архитектура: chat endpoint -> LLM -> tool_calls](#71-архитектура-chat-endpoint---llm---tool_calls)
  - [7.2 ChatTool и ChatToolParam](#72-chattool-и-chattoolparam)
  - [7.3 Реестр chat tools](#73-реестр-chat-tools)
  - [7.4 Agent loop](#74-agent-loop)
  - [7.5 Knowledge bases](#75-knowledge-bases)
  - [7.6 Пример: добавление нового chat tool](#76-пример-добавление-нового-chat-tool)
  - [7.7 Фронтенд: event-driven архитектура чата](#77-фронтенд-event-driven-архитектура-чата)
  - [7.8 Внешний ИИ-агент через таблицы БД](#78-внешний-ии-агент-через-таблицы-бд)
  - [7.9 Action-handlers и ClientActionBlock](#79-action-handlers-и-clientactionblock)
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
  - [9.6 Retention agent-bridge таблиц](#96-retention-agent-bridge-таблиц)

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
└── pytest.ini                    — конфигурация pytest
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
    ├── PostgreSQLAdapter   — имена с префиксом, CASCADE, GIN-индексы
    └── GreenplumAdapter    — schema-квалифицированные имена с префиксом, BIGSERIAL, Kerberos
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

> **Префикс таблиц.** Все таблицы доменов `acts`, `chat` и `admin` имеют общий префикс из `DATABASE__TABLE_PREFIX` (по умолчанию `t_db_oarb_audit_act_`). В таблицах и в коде ниже имена приведены без префикса для краткости — реальное имя в БД: `t_db_oarb_audit_act_<имя>` (на GP дополнительно квалифицируется схемой `{SCHEMA}.`). Подстановкой занимаются адаптеры (`PostgreSQLAdapter.get_table_name`, `GreenplumAdapter.get_table_name`).

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
| Имена таблиц | `{PREFIX}acts` | `{SCHEMA}.{PREFIX}acts` |
| Auto-increment | `SERIAL` | `BIGSERIAL` |
| CASCADE DELETE | Да | Нет (ручное управление) |
| ON CONFLICT | Да | Нет (DELETE + INSERT) |
| Индексы | GIN на JSONB | BTREE |
| Аутентификация | Пароль | Kerberos (kinit) |

Оба адаптера используют общие плейсхолдеры `{SCHEMA}` и `{PREFIX}` в `schema.sql`. PG-адаптер подставляет `{SCHEMA}.` → `""` и `{PREFIX}` → `DATABASE__TABLE_PREFIX`; GP-адаптер — `{SCHEMA}` → реальную схему и `{PREFIX}` → тот же префикс. За счёт этого имена таблиц совпадают в обеих СУБД (минус schema-qualifier на PG).

```python
class PostgreSQLAdapter(DatabaseAdapter):
    def __init__(self, table_prefix: str = ""):
        self.table_prefix = table_prefix  # t_db_oarb_audit_act_

    def get_table_name(self, base_name: str) -> str:
        return f"{self.table_prefix}{base_name}"
        # → t_db_oarb_audit_act_acts


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
        _adapter = PostgreSQLAdapter(
            table_prefix=settings.database.table_prefix
        )
        pool_kwargs = {
            "host": settings.database.host,
            "port": settings.database.port,
            "database": settings.database.name,
            "user": settings.database.user,
            "password": settings.database.password,
        }
    elif settings.database.type == "greenplum":
        _adapter = GreenplumAdapter(
            schema=settings.database.gp.schema_name,
            table_prefix=settings.database.table_prefix,
        )
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

### 6.8 Добавление UA-справочника

Справочники UA (процессы, тербанки, метрики, типы риска и т.п.) — read-only-таблицы домена `ua_data`, используемые из других доменов через `DictionaryRepository`. На PostgreSQL они создаются автоматически по миграции; на Greenplum таблицы и view создаются вручную (наполняются ETL).

Пошаговый чек-лист добавления нового справочника (на примере `violation_risk_type_dict`):

**Шаг 1. PostgreSQL-миграция.** Добавить `CREATE TABLE` + сидовые `INSERT … ON CONFLICT DO NOTHING` в `app/domains/ua_data/migrations/postgresql/schema.sql`. Колонки-метки актуальны: `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at`, `is_actual` — все справочники должны их иметь.

**Шаг 2. Настройки.** Добавить поле в `UaDataSettings` (`app/domains/ua_data/settings.py`) с дефолтным именем таблицы:

```python
violation_risk_type_dict: str = "t_db_oarb_ua_violation_risk_type_dict"
```

**Шаг 3. Репозиторий.** В `app/domains/ua_data/repositories/dictionary_repository.py`:
- проинициализировать атрибут через `q(s.<имя_поля>)` в `__init__`;
- добавить метод `get_<имя>() -> list[dict]` с фильтром `WHERE is_actual = true`.

**Шаг 4. Регистрация в потребителе.** Чтобы справочник стал доступен через `/api/v1/<domain>/dictionaries/{name}`:
- добавить ключ в `_DICT_DISPATCH` сервиса домена-потребителя (например, `app/domains/ck_fin_res/services/fr_validation_service.py`);
- расширить `Literal` в `app/domains/<domain>/api/dictionaries.py`.

**Шаг 5. `.env` и `.env.example`.** Добавить переменную `UA_DATA__<NAME>=t_db_oarb_…` в оба файла рядом с остальными `UA_DATA__*` — позволяет переопределить имя таблицы без релиза кода.

**Шаг 6. Фронтенд.** На странице, где справочник используется:
- добавить ключ справочника в `static dictNames = [...]` конфига (например, `ck-fin-res-config.js`);
- описать поле как `{ key: '<поле>', type: 'dictionary', dict: '<имя_справочника>' }`.

**Шаг 7. Greenplum (вручную).** Таблицы UA-справочников в GP создаются и наполняются ETL — приложение их только читает. Перед первым запуском в проде нужно вручную выполнить DDL на двух схемах:

```sql
-- 1. Проектная схема: реальная таблица (DATABASE__GP__SCHEMA)
CREATE TABLE s_grnplm_ld_audit_da_project_4.t_db_oarb_ua_violation_risk_type_dict (
    id          SERIAL PRIMARY KEY,
    risk        TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP,
    created_by  TEXT DEFAULT 'system',
    updated_by  TEXT,
    deleted_at  TIMESTAMP,
    is_actual   BOOLEAN NOT NULL DEFAULT true
)
DISTRIBUTED BY (id);

-- сидовые INSERT'ы (для GP — без ON CONFLICT, см. ограничения совместимости ниже)

-- 2. Sandbox-схема: представление для приложения
CREATE OR REPLACE VIEW s_grnplm_ld_audit_da_sandbox_oarb.v_db_oarb_ua_violation_risk_type_dict AS
SELECT id, risk, created_at, updated_at, created_by, updated_by, deleted_at, is_actual
FROM   s_grnplm_ld_audit_da_project_4.t_db_oarb_ua_violation_risk_type_dict;
```

GP-схема `app/domains/ua_data/migrations/greenplum/schema.sql` остаётся пустой (заглушкой) — она нужна только для прохождения автомиграции.

> **Важно для Greenplum:** в DDL не использовать `IF NOT EXISTS` для индексов, `ON CONFLICT`, `jsonb_set()`/`jsonb_pretty()`, `ADD COLUMN IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS` (GP 6.x ≈ PG 9.4). GP-адаптер выполняет SQL по одному statement и сам ловит `DuplicateTableError`/`DuplicateObjectError` — поэтому достаточно `CREATE INDEX` без `IF NOT EXISTS`.

**Шаг 8. Перезапуск.** На PG приложение создаст таблицу автоматически; на GP — после ручного DDL.

---

## 7. AI-ассистент

### 7.1 Архитектура: chat domain

**Поток запроса (общая схема):**

```
Browser (ChatManager + 11 модулей)
   │ HTTP POST /api/v1/chat/conversations/{id}/messages
   ▼
FastAPI (api/messages.py)
   │  → save_user_message (с транзакцией)
   │  → SSE generator (per-user семафор)
   ▼
ChatOrchestrator (services/orchestrator.py)
   ├─→ OpenAI-compatible LLM (chat completions, streaming)
   │    └─ tool_call → handler в domain.integrations.chat_tools
   │
   └─→ forward_to_knowledge_agent → AgentBridge
        └─ INSERT agent_requests
           AgentBridgeRunner (фоновая task):
             ├─ polling agent_response_events (poll_interval_sec)
             └─ при response → save_assistant_message
```

AI-ассистент реализован как доменный плагин `app/domains/chat/` с SSE-стримингом и agent loop. Локальная LLM (профиль `sglang` для прода / `openrouter` для dev — см. `app/domains/chat/services/llm_client.py`) выступает оркестратором: для **информационных запросов** (про данные/контент) решает форвардить во внешнего ИИ-агента через ChatTool `chat.forward_to_knowledge_agent` (см. [7.8](#78-внешний-ии-агент-через-таблицы-бд)); для **запросов на действие в интерфейсе** — вызывает локальный action-tool, возвращающий `ClientActionBlock` (см. [7.9](#79-action-handlers-и-clientactionblock)).

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
`message_start`, `block_start`, `block_delta`, `block_end`, `block_complete`, `tool_call`, `tool_result`, `plan_update`, `buttons`, `client_action`, `message_end`, `error`.

Маршрутизация: стримуемые типы (`text`, `code`, `reasoning`) идут триплетом `block_start` + `block_delta` + `block_end`; нестримуемые (`file`, `image`, `plan`, `error`) — одним `block_complete` с полным payload; `buttons` и `client_action` — собственные SSE-события.

**Блоки сообщений** (`app/core/chat/blocks.py`):
`TextBlock`, `CodeBlock`, `ReasoningBlock`, `PlanBlock`, `FileBlock`, `ImageBlock`, `ButtonGroup`, `ClientActionBlock`, `ErrorBlock`. Каноническое поле для `TextBlock`/`CodeBlock`/`ReasoningBlock` — `content`.

**Доменные исключения** (`app/domains/chat/exceptions.py`):
`ConversationNotFoundError`, `ChatFileNotFoundError`, `ChatLimitError`, `ChatFileValidationError`.

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
# Orchestrator получает msg_service, conv_service и settings через DI.
# file_service подключается через get_db() внутри _build_user_content
# (для извлечения текста файлов через extract_text_async).
orchestrator = Orchestrator(msg_service, conv_service, settings)

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

Клиент собирает выбранные базы знаний на фронтенде (`ChatContext.getEnabledKnowledgeBases()`) и передаёт их в `chat.forward_to_knowledge_agent` как параметр `knowledge_bases`. Forward-handler пишет их в `agent_requests.knowledge_bases` (JSONB) — внешний агент использует список как фильтр для своей RAG-логики. Управление доступными базами знаний — через `KnowledgeBase` в `DomainDescriptor` зарегистрированных доменов.

### 7.6 Пример: добавление нового chat tool

> Имя пакета `helpers` ниже — плейсхолдер. Замените на любое имя, подходящее вашему домену (например, `chat_helpers`).

**Шаг 1.** Создать handler:

```python
# app/domains/reports/integrations/helpers/export_reports.py
async def get_report_summary(report_id: int) -> str:
    """Получает краткое содержание отчета."""
    # ... логика
    return json.dumps(result, ensure_ascii=False)
```

**Шаг 2.** Экспортировать из `__init__.py`:

```python
# app/domains/reports/integrations/helpers/__init__.py
from .export_reports import get_report_summary
__all__ = ["get_report_summary"]
```

**Шаг 3.** Определить ChatTool:

```python
# app/domains/reports/integrations/chat_tools.py
def get_chat_tools() -> list[ChatTool]:
    from app.domains.reports.integrations.helpers import get_report_summary
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

**Пример структуры:** `<your_domain>/integrations/helpers/`

Развитая структура AI-интеграции для домена с большим количеством инструментов:

```
app/domains/<your_domain>/integrations/
├── chat_tools.py                    — определения ChatTool
└── helpers/
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

> **Важно:** для **информационных** запросов (про данные/контент актов и БЗ) локальные tools регистрировать НЕ нужно — это работа внешнего ИИ-агента (см. [7.8](#78-внешний-ии-агент-через-таблицы-бд)). Локальные tools оставлять только для **действий в интерфейсе** (открыть/создать/уведомить — см. [7.9](#79-action-handlers-и-clientactionblock)).

**Чек-лист «новый action-tool»:**

1. Константа имени в `app/core/chat/names.py` (`ACTION_*` или `TOOL_*`).
2. Handler в `app/domains/<domain>/integrations/chat_tools.py` (для tool) или в фабрике `client_action` (для action).
3. Регистрация в `app/core/chat/tools.py` registry.
4. **Фронтенд:** добавить имя в whitelist `static/js/shared/chat/chat-client-actions.js` (если это `client_action`), плюс реализовать handler в `ChatClientActionsRegistry`.
5. Если есть UI-кнопка из ассистента — см. **§7.8a button_translator** для маппинга текста кнопки → action.
6. Тест: `tests/domains/chat/` — проверить, что action/tool регистрируется и выполняется без сырых строк.

### 7.7 Фронтенд: event-driven архитектура чата

Фронтенд чата — vanilla ES6 без бандлера, **11 модулей** в `static/js/shared/chat/`, связанных через шину событий `ChatEventBus`. Три режима чата (inline на landing, modal в portal, popup в constructor) используют единый набор модулей.

**Модули и зоны ответственности:**

```
ChatEventBus           — шина событий (pub/sub, синхронная). Загружается ПЕРВОЙ.
ChatRenderer           — рендеринг блоков и сообщений в DOM
ChatClientActionsRegistry — реестр и исполнитель ClientActionBlock-команд
                          (open_url, notify, trigger_sdk; whitelist на фронте)
ChatStream             — SSE-клиент: POST /messages + GET resume-stream при разрыве
ChatHistory            — список бесед, CRUD, сворачиваемая панель
ChatUI                 — typing-индикатор, блокировка ввода, scroll, авторесайз
ChatFiles              — валидация файлов, drag-drop, превью, лимиты
ChatContext            — управление беседами, knowledge bases, домены
ChatMessages           — обработка SSE-событий, рендеринг user/bot сообщений
ChatManager            — тонкий фасад: инициализирует модули, делегирует через EventBus
ChatModalManager       — модальное окно (portal)
ChatPopupManager       — popup окно (constructor)
```

**Карта SSE-событий (от backend к фронту):**

| Событие | Маршрутизация | Используется |
|---------|---------------|--------------|
| `message_start` | один раз в начале | сброс `_streamingBlocks`, скрытие typing |
| `block_start` + `block_delta` + `block_end` | триплет | text, code, reasoning (стримуемые) |
| `block_complete` | одно событие | file, image, plan, error (нестримуемые) |
| `buttons` | одно событие | группа кнопок (action_id уже транслирован сервером) |
| `client_action` | одно событие | ClientActionBlock — исполняется ровно один раз |
| `agent_request_started` | один раз при forward | `request_id` для авто-resume при разрыве |
| `plan_update` | по мере прогресса | обновление PlanBlock |
| `tool_call` / `tool_result` | информационные | сейчас не рендерятся |
| `error` | terminal | блок ErrorBlock |
| `message_end` | один раз в конце | финализация |

**Порядок загрузки скриптов** (в `base_portal.html` и `base_constructor.html`):

```
chat-event-bus.js → chat-renderer.js → chat-client-actions.js →
chat-stream.js → chat-history.js → chat-ui.js → chat-files.js →
chat-context.js → chat-messages.js → chat-manager.js →
chat-modal.js / chat-popup.js
```

`chat-event-bus.js` обязан идти ПЕРВЫМ — остальные модули могут публиковать `window.X = new ...` и подписываться на шину при загрузке.

**Ключевые паттерны:**

- **Защита от повторной инициализации**: каждый модуль хранит `_initialized` флаг и выходит из `init()` при повторном вызове
- **Ленивая инициализация**: `ChatModalManager`/`ChatPopupManager` вызывают `ChatManager.init()` при первом открытии
- **ClientAction исполняется ровно один раз**: в момент SSE-события `client_action` через `ChatRenderer.renderBlock(block, {execute: true})`. При рендере истории `{execute: false}` — только label-чип. Иначе пользователь застрянет в редирект-цикле
- **Auto-resume при разрыве SSE**: `ChatStream` запоминает `request_id` из `agent_request_started` и при разрыве переоткрывает `GET /conversations/{cid}/agent-request/{rid}/stream?since=<seq>`. Курсор по `seq` (не id) — `id` в Greenplum не монотонен между сегментами
- **DOM API в `chat-history`**: список бесед рендерится через `document.createElement`/`textContent`/`dataset`, не через `innerHTML` — защита от XSS через title беседы (= первое сообщение пользователя)
- **Whitelist в `chat-client-actions`**: `open_url` принимает только `http:/https:/mailto:/relative`; `trigger_sdk` — только методы из `ALLOWED_SDK_METHODS` (по умолчанию пустой)

### 7.8 Внешний ИИ-агент через таблицы БД

Для запросов про **данные/контент** (БЗ актов, регламенты, нормативы) локальная LLM делегирует работу внешнему ИИ-агенту коллег через очередь в основной БД. Агент-сервис разрабатывается отдельной командой; AW не делает HTTP-запросов к нему — взаимодействие исключительно через таблицы.

> Имена `agent_requests`, `agent_response_events`, `agent_responses`, `chat_files` далее даны без префикса. В БД они хранятся с префиксом `DATABASE__TABLE_PREFIX` (по умолчанию `t_db_oarb_audit_act_`); полные имена SQL-сниппетов для копи-пасты — в `docs/external-agent-imitation.sql`.

**Поток:**

```
LLM-оркестратор → tool chat.forward_to_knowledge_agent
    ↓ INSERT в agent_requests (status='pending', history, files, kb_hint)
    ↓ возвращает sentinel "<<forwarded_request:UUID>>"

Orchestrator:
    ↓ agent_bridge_runner.schedule(request_id) — фоновая задача стартует
    ↓ yield SSE: agent_request_started {request_id}
    ↓ оркестратор сам ЧИТАЕТ из БД и эмитит SSE (НЕ держит polling-цикл)

Фоновый раннер (agent_bridge_runner):
    ↓ UPDATE status=dispatched, started_at=now()
    ↓ polling agent_response_events (курсор по seq, не id)
    ↓ при первом event: UPDATE status=in_progress
    ↓ при agent_responses: UPDATE status=done, save_assistant_message в БД

SSE → клиент:
    ↓ agent_request_started → ChatStream запоминает request_id
    ↓ reasoning deltas, финальные блоки
    ↓ при разрыве — фронт переоткрывает GET /agent-request/{rid}/stream?since=<seq>
```

**Таблицы** (`app/domains/chat/migrations/{postgresql,greenplum}/schema.sql`):

| Таблица | Кто пишет | Назначение |
|---|---|---|
| `agent_requests` | AW (raннер обновляет status) | Очередь запросов к агенту. Стадии status — см. ниже |
| `agent_response_events` | агент | Append-only лента событий: `reasoning`, `status`, `error`. **Курсор polling — по `seq`, не `id`** (в GP id не монотонен между сегментами) |
| `agent_responses` | агент | Однократный INSERT финального ответа (UNIQUE по `request_id` — stop-сигнал) |

**Стадии `agent_requests.status`:**

| Статус | Кто ставит | Что значит |
|---|---|---|
| `pending` | bridge.send() | INSERT только что произошёл, раннер ещё не подхватил (~миллисекунды) |
| `dispatched` | раннер при старте polling | AW-раннер взял в работу, ждёт первого события от агента |
| `in_progress` | раннер при первом event | Внешний агент пишет события |
| `done` | раннер | Финальный ответ агента сохранён, ассистент-message в БД |
| `error` | раннер | Ошибка раннера или агента (см. `error_message`) |
| `timeout` | раннер | Сработал один из трёх гейтов `wait_for_completion` |

**Архитектурные ограничения:**

- **Polling-only**, без LISTEN/NOTIFY и постоянных соединений (между AW и агент-сервисом нет прямой сети — оба общаются только через БД).
- **Greenplum-first**: схема DDL построена под GP (VARCHAR(36) для id, `{SCHEMA}.{PREFIX}` placeholders, `DISTRIBUTED BY (conversation_id)` для requests и `(request_id)` для events/responses).
- **Polling-задача отвязана от SSE-соединения**: при обрыве клиента раннер дописывает ответ в БД. При перезапуске uvicorn — lifespan reconcile через `agent_bridge_runner.schedule_pending()` (см. `app/main.py`).
- **Retention** — задача администратора (в приложении НЕ реализован). См. §7.8.6 ниже и `docs/external-agent-imitation.sql` (раздел 5) для SQL-сниппетов.
- **Восстановление SSE** после обрыва — endpoint `GET /conversations/{id}/agent-request/{rid}/stream?since={seq}` (`api/messages.py`). Курсор по `seq`.

**Ключевые модули:**
- `app/domains/chat/services/agent_bridge.py` — `AgentBridgeService.send/poll_events/poll_response/wait_for_completion`. Курсор `since_seq`.
- `app/domains/chat/services/agent_bridge_runner.py` — фоновый раннер polling+save: `schedule(rid, settings)`, `is_running(rid)`, `schedule_pending(settings, older_than_sec=30)` для lifespan-reconcile. Process-level registry `_running: dict[str, asyncio.Task]` защищает от дублей.
- `app/domains/chat/services/button_translator.py` — общая трансляция action_id (имя ChatTool) → клиентский action. Используется в орк-е, раннере, resume-эндпоинте.
- `app/domains/chat/services/block_emitter.py` — общий SSE-эмиттер блоков ответа агента (правила: text/code/reasoning → триплет; file/image/plan/error → block_complete; buttons → sse_buttons; client_action → sse_client_action).
- `app/domains/chat/integrations/forward_handler.py` — фабрика `build_forward_handler(...)`, sentinel-pattern
- `app/domains/chat/repositories/agent_*_repository.py` — три CRUD-репозитория. `AgentRequestRepository.find_pending(older_than_sec)` для reconcile.
- `app/domains/chat/services/{llm_client,retry,tool_call_accumulator}.py` — провайдер-агностичная LLM-инфра (OpenRouter/SGLang quirks: `index=None` fallback, `reasoning_details` для MiniMax M2)

**Гейты таймаутов** в `wait_for_completion`: три независимых, срабатывание любого → `status='timeout'` + `AgentBridgeTimeout`.

| Гейт | Когда активен | Настройка |
|---|---|---|
| `initial_response` | Пока не пришло ни одного события | `CHAT__AGENT_BRIDGE__INITIAL_RESPONSE_TIMEOUT_SEC` |
| `event_heartbeat` | После первого события (простой между событиями) | `CHAT__AGENT_BRIDGE__EVENT_TIMEOUT_SEC` |
| `max_total` | Всегда (с момента INSERT) | `CHAT__AGENT_BRIDGE__MAX_TOTAL_DURATION_SEC` |

#### Шпаргалка по имитации агента

Полный SQL — в `external-agent-imitation.sql` в корне (DBeaver/psql).
Ниже — минимум для понимания формата.

**Что в `agent_requests` (вход агента):**

```jsonc
// history — усечённый диалог; reasoning-блоки в него не попадают
[
  {"role": "user",      "content": "Найди регламент по КСО"},
  {"role": "assistant", "content": "..."}
]

// files — только метаданные. Тело файла — в chat_files по file_id
[{"type":"file","file_id":"8f4c1...","filename":"акт.pdf",
  "mime_type":"application/pdf","file_size":124533}]

// knowledge_bases — ключи из UI-toggle + kb_hint от LLM
["acts_default","regulations_2024"]
```

**Стрим reasoning** (можно несколько раз):

```sql
INSERT INTO agent_response_events
    (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('agent_response_events_id_seq'),
    '<request_id>', 1, 'reasoning',
    '{"text":"Ищу регламент в acts_default."}'::jsonb,
    now()
);
```

**Финальный ответ** (без него фронт не закроет typing-индикатор):

```sql
INSERT INTO agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
VALUES (
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    '[{"type":"text","content":"КСО — корпоративная социальная ответственность..."}]'::jsonb,
    'stop', 'imitated-agent', now()
);

UPDATE agent_requests SET status='done', finished_at=now()
WHERE id='<request_id>';
```

**Типы блоков ответа** (из `app/core/chat/blocks.py`): `text`, `code`, `reasoning`, `plan`, `file`, `image`, `buttons`, `client_action`, `error`. Маршрутизация: стримуемые (`text`/`code`/`reasoning`) идут триплетом `block_start`+`block_delta`+`block_end`; нестримуемые (`file`, `image`, `plan`, `error`) — одним `block_complete` с полным payload; `buttons` и `client_action` — собственные SSE-события `event: buttons` и `event: client_action`.

**Кнопки и client_action** — `action_id`/`action` берутся из реестра `window.ClientActionsRegistry`. Ходовые: `acts.open_act_page`, `open_url`, `notify`. См. §7.9.

#### Шпаргалка по файлам

**Агент читает файл пользователя** — JOIN по `conversation_id` (защита от чужих файлов):

```sql
SELECT cf.filename, cf.mime_type, cf.file_data
FROM chat_files cf
JOIN agent_requests ar ON ar.conversation_id = cf.conversation_id
WHERE ar.id = '<request_id>' AND cf.id = '<file_id>';
```

**Агент отправляет файл пользователю** — два INSERT'а: байты в `chat_files`, потом `FileBlock` в `agent_responses.blocks`. `conversation_id` обязан совпадать с тем, что в `agent_requests` (иначе AW вернёт 404 — `FileService.get_file` проверяет владельца через `chat_conversations.user_id`).

Для бинарников (pdf/xlsx) инлайн-SQL неудобен — XLSX это ZIP с несколькими XML внутри, руками не собрать. Удобнее Python-хелпер:

```python
# Использование:
#   python -m scripts.imitate_agent_file <request_id> /tmp/metrics.xlsx \
#       --text "Подготовил выгрузку метрик"
import asyncio, mimetypes, uuid, json, os
from pathlib import Path
import asyncpg

DSN = os.environ.get("DATABASE_URL", "postgresql://...localhost/audit_workstation")
MIME_OVERRIDES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

async def send_file_as_agent(request_id: str, path: Path, text: str) -> None:
    data = path.read_bytes()
    mime = MIME_OVERRIDES.get(path.suffix.lower()) \
           or (mimetypes.guess_type(path.name)[0] or "application/octet-stream")
    file_id = str(uuid.uuid4())
    conn = await asyncpg.connect(DSN)
    try:
        row = await conn.fetchrow(
            "SELECT conversation_id FROM agent_requests WHERE id=$1", request_id,
        )
        await conn.execute(
            "INSERT INTO chat_files "
            "(id, conversation_id, message_id, filename, mime_type, "
            " file_size, file_data, created_at) "
            "VALUES ($1, $2, NULL, $3, $4, $5, $6, now())",
            file_id, row["conversation_id"], path.name, mime, len(data), data,
        )
        blocks = [
            {"type": "text", "content": text},
            {"type": "file", "file_id": file_id, "filename": path.name,
             "mime_type": mime, "file_size": len(data)},
        ]
        await conn.execute(
            "INSERT INTO agent_responses (id, request_id, blocks, "
            "finish_reason, model, created_at) "
            "VALUES ($1, $2, $3::jsonb, 'stop', 'imitated-agent', now())",
            str(uuid.uuid4()), request_id,
            json.dumps(blocks, ensure_ascii=False),
        )
        await conn.execute(
            "UPDATE agent_requests SET status='done', finished_at=now() "
            "WHERE id=$1", request_id,
        )
    finally:
        await conn.close()
```

Реальный xlsx генерируется на лету через `openpyxl`:

```python
from openpyxl import Workbook
wb = Workbook(); ws = wb.active
ws.append(["КМ", "Метрика", "Значение"])
ws.append(["КМ-12-32141", "Выручка", 14523000])
wb.save("/tmp/metrics.xlsx")
# затем asyncio.run(send_file_as_agent(rid, Path("/tmp/metrics.xlsx"), "Готово:"))
```

Файл появится в чате сразу (через SSE `block_complete`), без перезагрузки. Регрессия покрыта тестом `test_orchestrator_forward_integration.py::test_file_block_emits_block_complete_with_full_payload`.

Для TXT хватит чистого SQL — `convert_to(...)` берёт обычную строку и не требует Python; см. §4a.1 в `external-agent-imitation.sql`.

#### Когда «у меня не работает»

- В чате тишина после вопроса → нет INSERT в `agent_requests` ⇒ LLM не решил форвардить (нет toggle базы знаний / system prompt не подсказал / handler не зарегистрирован для домена).
- Reasoning-чанки не появляются → проверь `CHAT__AGENT_BRIDGE__POLL_INTERVAL_SEC` и логи `agent_bridge polling: ...`.
- Запрос обрывается с `timeout` → `agent_requests.error_message` подскажет, какой из трёх гейтов сработал.
- Файл не отображается до перезагрузки → SSE `block_complete` не дошёл. Регрессия в тесте выше; локально проверь `static/js/shared/chat/chat-messages.js` case `'block_complete'`.
- Клик «Скачать» возвращает 404 → `chat_files.conversation_id` ≠ `agent_requests.conversation_id`. Бери из запроса, не выдумывай.

#### 7.8.6 Retention и очистка hot-таблиц

В приложении НЕТ кода ретеншена — это сознательное решение: на проде GP таблицы партиционируются, а DELETE-ы под нагрузкой стоят дороже DROP PARTITION. Очистка — задача администратора БД, выполняется снаружи (pg_cron, Airflow, Datalab или ручной cron).

**Рекомендуемые сроки** (дефолт; подстраивай под аудит-требования):

| Таблица | Срок жизни | Что хранится |
|---|---|---|
| `agent_response_events` | 30 дней | Reasoning-чанки и status-события стрима. Используются только в момент стрима + изредка для аудита |
| `agent_responses` | 180 дней | Финальные ответы. Уже скопированы в `chat_messages.content`, держим как «исходник» для разбора инцидентов |
| `agent_requests` (`done`/`error`/`timeout`) | 180 дней | Входы агента (history, files, knowledge_bases). Дублируется в `chat_messages` пользователя |
| `chat_files` | не трогать | Часть истории чата; удаление каскадно через `chat_messages` |

**Запросы с `status IN ('pending', 'dispatched', 'in_progress')` НЕ ТРОГАЙ ретеншеном** — это активные форварды, lifespan reconcile подхватит их при рестарте. Удалять их можно только если они зависли дольше `CHAT__AGENT_BRIDGE__MAX_TOTAL_DURATION_SEC` × несколько раз (раннер сам пометит их `timeout`).

**Стратегии:**

- **PostgreSQL (dev / маленький объём)**: DELETE по `created_at` + `VACUUM ANALYZE` ночным cron'ом. Партиции не нужны — autovacuum справится. Снippets — раздел 5 в `docs/external-agent-imitation.sql`.
- **Greenplum (prod / большие объёмы)**: `agent_response_events` рекомендуется партиционировать по `created_at` (RANGE, month). Снимать партиции `DROP PARTITION` вместо DELETE — на порядок быстрее и не лочит таблицу. `agent_responses`/`agent_requests` обычно растут медленнее, можно DELETE+VACUUM.

**GP-партиционирование (пример для админа):**

```sql
ALTER TABLE agent_response_events
    PARTITION BY RANGE (created_at)
    (START (date '2026-01-01') INCLUSIVE
     END   (date '2027-01-01') EXCLUSIVE
     EVERY (INTERVAL '1 month'));
-- Применяется в migration-один-раз, до того как таблица распухнет.
-- Раз в месяц cron добавляет новую партицию (ALTER TABLE … ADD PARTITION).
-- Старые партиции дропаются: ALTER TABLE … DROP PARTITION FOR (date '2026-04-01').
```

**Cron-периодичность:**

- `agent_response_events` — ежедневно ночью (DELETE/DROP PARTITION).
- `agent_responses` + `agent_requests` — еженедельно.
- `VACUUM ANALYZE` — после каждой массивной чистки (PG); GP — `VACUUM FULL` только при заметной фрагментации.

Размер метаданных пары `(request, response)` — единицы килобайт; `agent_response_events` при стриме 50–100 чанков по 200 байт = ~10–20 KB на запрос. На 1000 запросов в день → ~20 MB/день именно событий, остальное — пренебрежимо.

#### 7.8a Button Translator

Внешний агент возвращает кнопки в **семантическом** виде — с `action_id`, равным имени серверного `ChatTool` (например, `acts.open_act_page`). Фронт такой `action_id` не понимает: его реестр (`window.ClientActionsRegistry`) знает только клиентские примитивы — `open_url`, `notify`, `trigger_sdk`. Между ними должен встать **резолвер**, который умеет ходить в БД и превращать «открой акт КМ-23-001» в `open_url` с готовым `/constructor?act_id=42`. Этим занимается `button_translator`.

**Где применяется** (`app/domains/chat/services/button_translator.py`, 69 строк):
- В оркестраторе перед эмитом SSE-события `event: buttons` в live-стриме.
- В `agent_bridge_runner` перед сохранением финального ответа агента в `chat_messages.content` (`_translate_buttons_in_blocks`).
- В resume-эндпоинте `GET /agent-request/{rid}/stream` при пересборке потока из БД.

Кнопка без зарегистрированного `ChatTool` или без `button_translator` пропускается как есть (с WARN в логи) — пользователь увидит её, но клик не сработает.

**Когда добавлять**: для любого нового `ChatTool` категории `action`, который LLM/агент будет предлагать в виде кнопки (`buttons`-блок). Если tool вызывается **только** через `tool_call` (LLM сама исполняет, не показывая кнопку), translator не нужен.

**Регистрация** — поле `button_translator` в датакласс `ChatTool` (`app/core/chat/tools.py`):

```python
# app/domains/acts/integrations/action_handlers.py
from app.core.chat.names import ACTION_NOTIFY, ACTION_OPEN_URL


async def open_act_page_button_translator(params: dict) -> dict:
    """Транслятор серверной кнопки acts.open_act_page → клиентский action.

    Резолвит КМ/СЗ в URL акта; на успехе — open_url, иначе — notify уровня error.
    Сигнатура фиксирована: принимает params самой кнопки, возвращает
    {"action": <client-action>, "params": {...}} или None.
    """
    km = (params or {}).get("km_number")
    sz = (params or {}).get("sz_number")
    url = await resolve_act_url(km, sz)
    if url:
        return {"action": ACTION_OPEN_URL, "params": {"url": url}}
    identifier = km or sz or "?"
    return {
        "action": ACTION_NOTIFY,
        "params": {"message": f"Акт {identifier} не найден", "level": "error"},
    }


# app/domains/acts/integrations/chat_tools.py
ChatTool(
    name=TOOL_OPEN_ACT_PAGE,
    domain="acts",
    description="Открыть страницу конкретного акта…",
    parameters=[...],
    handler=open_act_page_handler,
    category="action",
    button_translator=open_act_page_button_translator,  # ← вот этот хук
)
```

После трансляции SSE отдаёт фронту уже клиентский формат:

```jsonc
// До translator (что прислал агент):
{"action_id": "acts.open_act_page", "label": "Открыть КМ-23-001",
 "params": {"km_number": "КМ-23-001"}}

// После translator (что получает chat-messages.js):
{"action_id": "open_url", "label": "Открыть КМ-23-001",
 "params": {"url": "/constructor?act_id=42"}}
```

Аналогичные пары handler/translator есть в `app/domains/ck_fin_res/integrations/action_handlers.py`, `app/domains/ck_client_exp/integrations/action_handlers.py`, `app/domains/admin/integrations/action_handlers.py` — они переиспользуют единый шаблон.

#### 7.8b SSE Protocol Reference

Все SSE-форматеры собраны в `app/domains/chat/services/streaming.py`. Каждое событие — это пара строк `event: <type>\ndata: <json>\n\n`. Канонические структуры блоков — в `app/core/chat/blocks.py` (Pydantic-модели `MessageBlock`).

**Таблица событий:**

| Событие | Payload (краткая схема) | Когда эмитится |
|---|---|---|
| `message_start` | `{conversation_id: str, message_id: str}` | Один раз в начале ответа ассистента |
| `block_start` | `{index: int, type: str}` | Открытие стримуемого блока (`text` / `code` / `reasoning`) |
| `block_delta` | `{index: int, delta: str}` | Инкремент текста стримуемого блока (много раз) |
| `block_end` | `{index: int}` | Закрытие стримуемого блока |
| `block_complete` | `{index: int, block: <MessageBlock>}` | Нестримуемый блок целиком (`file`, `image`, `plan`, `error`) |
| `buttons` | `{buttons: [<ButtonsBlock.buttons>]}` | Группа кнопок (`action_id` уже транслирован сервером) |
| `client_action` | `{block: <ClientActionBlock>}` | Команда фронту — исполняется **ровно один раз** |
| `agent_request_started` | `{request_id: str, conversation_id: str}` | Один раз сразу после INSERT в `agent_requests` |
| `plan_update` | `{steps: [{...}]}` | Обновление PlanBlock (опционально) |
| `tool_call` / `tool_result` | `{tool_name, tool_call_id, arguments|result}` | Информационные; сейчас не рендерятся фронтом |
| `error` | `{error: str, code?: str}` | Terminal-ошибка стрима |
| `message_end` | `{message_id: str, model?: str, token_usage?: {...}}` | Один раз в конце |

**Правила маршрутизации блоков:**
- **Стримуемые** (`text`, `code`, `reasoning`) идут триплетом `block_start` + N×`block_delta` + `block_end`.
- **Нестримуемые** (`file`, `image`, `plan`, `error`) — одним `block_complete` с полным payload. **Никогда не парой `block_start`+`block_end` без delta** — фронт создаст пустой text-контейнер, и блок появится только после перезагрузки истории (см. CLAUDE.md).
- **Buttons** — собственное событие `event: buttons`.
- **Client action** — собственное событие `event: client_action`; исполняется **ровно один раз** при получении, при рендере истории `{execute: false}` (см. §7.9).

**Пример полного стрима** (диалог: пользователь спросил «Открой КМ-23-001 и расскажи о КСО», ответ: reasoning → forward к агенту → text → кнопка → конец):

```jsonc
// 1. Старт ответа
event: message_start
data: {"conversation_id":"a1b2…","message_id":"m1"}

// 2. LLM стримит reasoning (триплет)
event: block_start
data: {"index":0,"type":"reasoning"}
event: block_delta
data: {"index":0,"delta":"Пользователь просит открыть акт и спрашивает про КСО. "}
event: block_delta
data: {"index":0,"delta":"Делегирую запрос про КСО агенту знаний."}
event: block_end
data: {"index":0}

// 3. Форвард к внешнему агенту зарегистрирован
event: agent_request_started
data: {"request_id":"r-77c1…","conversation_id":"a1b2…"}

// 4. Финальный текст ассистента (триплет)
event: block_start
data: {"index":1,"type":"text"}
event: block_delta
data: {"index":1,"delta":"КСО — корпоративная социальная ответственность…"}
event: block_end
data: {"index":1}

// 5. Кнопка действия (action_id уже транслирован → клиентский)
event: buttons
data: {"buttons":[{"action_id":"open_url","label":"Открыть КМ-23-001",
                    "params":{"url":"/constructor?act_id=42"}}]}

// 6. Конец
event: message_end
data: {"message_id":"m1","model":"qwen-8b","token_usage":{"prompt":1230,"completion":340}}
```

При client-action (например, LLM хочет немедленно открыть страницу без кнопки) сразу после `block_end` пойдёт `event: client_action` с полным `ClientActionBlock`, и фронт исполнит редирект через `ClientActionsRegistry.execute(...)` без участия пользователя.

### 7.9 Action-handlers и ClientActionBlock

Action-tools — это ChatTool'ы для **действий в интерфейсе** (открыть страницу, показать уведомление, навигировать, активировать SDK). Их handler возвращает JSON-сериализованный `ClientActionBlock`, оркестратор парсит ответ и эмитит SSE-событие `event: client_action`, фронт исполняет команду через `ClientActionsRegistry`.

**Поток:**

```
LLM выдал tool_call → Orchestrator._execute_tool_call(name, args)
    ↓ handler возвращает str (JSON-encoded ClientActionBlock)
Orchestrator._parse_client_action_result(raw)
    ↓ если type == "client_action" → block в emitted_blocks
SSE: yield sse_client_action(block=client_action)
    ↓ фронт chat-messages.js: case 'client_action'
ChatRenderer.renderBlock(block, {execute: true})
    ↓ _renderClientAction → ClientActionsRegistry.execute(action, params)
```

**Реестр клиентских команд** (`static/js/shared/chat/chat-client-actions.js`):

| action | params | Что делает |
|---|---|---|
| `open_url` | `{url: string}` | `window.location.href = url` |
| `notify` | `{message: string, level?: 'info'\|'success'\|'warning'\|'error'}` | Toast через `window.Notifications.show` |
| `trigger_sdk` | `{method: string, args?: any[]}` | `window[method](...args)` — вызов глобальной SDK-функции |

Регистрация дополнительных команд в JS: `ClientActionsRegistry.register('my_action', ({...params}) => {...})`.

**Критическое правило**: `ClientActionBlock` исполняется **ровно один раз** в момент получения SSE-события. При рендере исторических сообщений (загрузка из `chat_messages.content`) фронт вызывает `ChatRenderer.renderBlocks(container, blocks, {execute: false})` — отображает только label-чип, без исполнения. Иначе пользователь застрянет в редирект-цикле.

**Пример action-handler'а** (`app/domains/acts/integrations/action_handlers.py`):

```python
async def open_act_page_handler(
    *, km_number: str | None = None, sz_number: str | None = None,
) -> str:
    """Поиск акта по КМ/СЗ → ClientActionBlock(open_url) или текст с просьбой уточнить."""
    if not km_number and not sz_number:
        return "Не указан ни КМ-номер, ни номер служебной записки."

    # ВАЖНО: импорты внутри функции — для тестов через
    # patch.multiple("app.db.connection", get_db=..., get_adapter=...)
    from app.db.connection import get_adapter, get_db

    # ... build SQL query ...
    async with get_db() as conn:
        rows = await conn.fetch(sql, *params)

    if len(rows) == 1:
        return json.dumps({
            "type": "client_action",
            "action": "open_url",
            "params": {"url": f"/constructor?act_id={rows[0]['id']}"},
            "label": f"Открываю акт {rows[0]['km_number']}…",
        }, ensure_ascii=False)
    # ... 0 / multiple branches return plain text ...
```

Регистрация в `chat_tools.py` домена — обычная (с `category="action"`), всё как описано в [7.6](#76-пример-добавление-нового-chat-tool).

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

Для production (без перезагрузки, **только один воркер**):

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

**Важно:** приложение разработано под single-worker деплой. На старте
lifespan захватывает singleton-блокировку в таблице
`{PREFIX}app_singleton_lock` (см. `app/core/singleton_lock.py`):
второй воркер этого же сервиса упадёт с понятным сообщением. Это
сознательное ограничение — в закрытой сети нет Redis/etcd, а
process-level состояние (`agent_bridge_runner._running`, in-process
SSE-семафор `_active_streams_per_user`) безопасно только при одном
процессе. Stale-lock (после kill -9) автоматически перезахватывается
через TTL=60с.

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
DATABASE__TABLE_PREFIX=t_db_oarb_audit_act_
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
| | `DATABASE__TABLE_PREFIX` | str | `t_db_oarb_audit_act_` | Общий префикс таблиц приложения (PG и GP) |
| **БД: Greenplum** | `DATABASE__GP__HOST` | str | `gp_dns_...` | Хост GP |
| | `DATABASE__GP__PORT` | int | `5432` | Порт GP |
| | `DATABASE__GP__DATABASE` | str | `capgp3` | Имя БД GP |
| | `DATABASE__GP__SCHEMA` | str | `s_grnplm_...` | Схема GP |
| **Безопасность** | `SECURITY__MAX_REQUEST_SIZE` | int | `10485760` | Макс. размер запроса (байт) |
| | `SECURITY__RATE_LIMIT_PER_MINUTE` | int | `1024` | Лимит запросов/мин на IP |
| | `SECURITY__MAX_TRACKED_IPS` | int | `100` | Макс. отслеживаемых IP |
| | `SECURITY__RATE_LIMIT_TTL` | int | `120` | TTL метрик (сек) |
| **Чат** (доменные) | `CHAT__PROFILE` | str | `sglang` | Профиль LLM-провайдера: `sglang` (прод), `openrouter`/`openai` (dev) |
| | `CHAT__API_BASE` | str | (пусто) | Базовый URL LLM API (без `/chat/completions` — SDK добавит сам) |
| | `CHAT__API_KEY` | SecretStr | (пусто) | API-ключ |
| | `CHAT__MODEL` | str | `gpt-4o` | Модель |
| | `CHAT__TEMPERATURE` | float | `0.1` | Температура (0-2) |
| | `CHAT__MAX_TOOL_ROUNDS` | int | `5` | Макс. раундов tool-calling |
| | `CHAT__STREAMING_ENABLED` | bool | `True` | SSE-стриминг ответов |
| | `CHAT__REQUEST_TIMEOUT` | int | `60` | Timeout запроса к LLM (сек) |
| | `CHAT__TOOL_EXECUTION_TIMEOUT` | int | `30` | Timeout инструмента (сек) |
| | `CHAT__SMALLTALK_MODE` | str | `local` | `local` — отвечает локальный LLM; `forward` — пробрасывать всё внешнему агенту |
| | `CHAT__SYSTEM_PROMPT` | str | `Ты — AI-ассистент...` | Системный промпт |
| | `CHAT__MAX_HISTORY_LENGTH` | int | `50` | Макс. сообщений в истории |
| | `CHAT__MAX_MESSAGE_CONTENT_LENGTH` | int | `10000` | Макс. длина сообщения |
| | `CHAT__MAX_FILE_SIZE` | int | `10485760` | Макс. размер файла (байт) |
| | `CHAT__MAX_FILES_PER_MESSAGE` | int | `5` | Макс. файлов в сообщении |
| | `CHAT__MAX_TOTAL_FILE_SIZE` | int | `31457280` | Макс. суммарный размер файлов в сообщении (байт) |
| | `CHAT__MAX_CONVERSATIONS_PER_USER` | int | `100` | Макс. разговоров на пользователя |
| | `CHAT__MAX_MESSAGES_PER_CONVERSATION` | int | `500` | Макс. сообщений в разговоре |
| **Чат: Retry** | `CHAT__RETRY__ON_429` | bool | `True` | Повторять при 429 (rate-limit) |
| | `CHAT__RETRY__ON_5XX` | bool | `True` | Повторять при 5xx |
| | `CHAT__RETRY__MAX_ATTEMPTS` | int | `5` | Макс. попыток |
| | `CHAT__RETRY__BACKOFF_BASE_SEC` | float | `2.0` | База экспоненциального backoff (сек) |
| **Чат: Мост к агенту** | `CHAT__AGENT_BRIDGE__POLL_INTERVAL_SEC` | float | `1.0` | Интервал polling таблиц `agent_*` |
| | `CHAT__AGENT_BRIDGE__INITIAL_RESPONSE_TIMEOUT_SEC` | int | `300` | Гейт 1: время до первого события/ответа |
| | `CHAT__AGENT_BRIDGE__EVENT_TIMEOUT_SEC` | int | `120` | Гейт 2: heartbeat между событиями |
| | `CHAT__AGENT_BRIDGE__MAX_TOTAL_DURATION_SEC` | int | `1800` | Гейт 3: общий таймаут запроса |
| | `CHAT__AGENT_BRIDGE__HISTORY_LIMIT` | int | `30` | Лимит сообщений истории, передаваемой агенту |
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

### 9.6 Retention agent-bridge таблиц

Мост к внешнему ИИ-агенту использует три таблицы (см. §7.8) в основной БД:

| Таблица | Что накапливается | Удалять можно |
|---|---|---|
| `agent_response_events` | Лента стрима (`reasoning`, `status`, `error`). 50–100 чанков на запрос, по 200 байт ≈ 10–20 KB | Да, после `done`/`error`/`timeout` |
| `agent_responses` | Финальный JSON-ответ агента, ~единицы KB | Да, после `done`/`error`/`timeout` |
| `agent_requests` | История запросов (history, files, knowledge_bases) | Да, по `status` + `finished_at` |

**Ключевое утверждение**: финальные ответы внешнего ИИ-агента — `reasoning`, текст и ошибки — **агрегируются раннером** (`app/domains/chat/services/agent_bridge_runner.py:120-206`) и сохраняются в `chat_messages.content` (JSONB). Очистка `agent_*`-таблиц **НЕ удаляет** видимую пользователю историю чата: пользователь читает `chat_messages`, а не `agent_*`. `agent_*` нужны только в момент стрима + изредка для разбора инцидентов.

**Правила безопасной очистки:**

1. Удалять только записи с `status IN ('done', 'error', 'timeout')`.
2. И только те, у которых `finished_at IS NOT NULL AND finished_at < now() - INTERVAL 'N days'` (рекомендация: 30 дней).
3. **Не трогать** `pending`, `dispatched`, `in_progress` — это активные форварды. Их разрулят сам раннер (по таймауту) или lifespan reconcile при рестарте uvicorn (`agent_bridge_runner.schedule_pending(older_than_sec=30)`).

**Каскад удалений** — формальных FK между `agent_*` нет, но логически:

```
agent_response_events.request_id  ──┐
agent_responses.request_id        ──┤──► agent_requests.id
```

Поэтому удаляем сверху вниз: сначала `agent_response_events`, затем `agent_responses`, и только в конце сами `agent_requests`. Иначе orphan-строки в events/responses останутся и продолжат занимать место.

**Команды** — отдельный скрипт `docs/agent-bridge-cleanup.sql` (совместим с PG и Greenplum 6.x). Плейсхолдеры `{SCHEMA}`/`{PREFIX}` подставляются вручную перед запуском:

```bash
sed 's/{SCHEMA}/s_grnplm_ld_audit_da_project_4/g; s/{PREFIX}/t_db_oarb_audit_act_/g' \
    docs/agent-bridge-cleanup.sql | psql ...
```

Срок хранения задан фиксированной константой `INTERVAL '30 days'` (правится во всех трёх DELETE-ах одновременно — в шапке файла есть комментарий, где менять).

**Рекомендация по частоте**: cron раз в неделю в окне низкой нагрузки. После массовой чистки — `VACUUM ANALYZE` (раскомментировать в конце скрипта). На GP `agent_response_events` имеет смысл партиционировать по `created_at` (RANGE month) — `DROP PARTITION` на порядок быстрее DELETE и не лочит таблицу; см. §7.8.6 для примера ALTER.

Подробности по политике хранения (рекомендованные сроки на 30/180/365 дней, обоснование «почему ретеншена нет в коде», GP-стратегия) — в §7.8.6.
