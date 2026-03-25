# Audit Workstation

Рабочая станция аудитора — единая среда для проведения проверок. Включает конструктор актов, портал управления, AI-ассистента с function-calling, экспорт документов, интеграции с хранилищами данных (Hive/Greenplum) и плагинную архитектуру доменов для расширения функциональности.

## Требования

- **Python** 3.11+
- **PostgreSQL** 14+ (основная БД) или **Greenplum** 6+ (через Kerberos)
- **Kerberos** (`kinit`) — только при работе с Greenplum

## Быстрый старт

### 1. Клонирование и установка зависимостей

```bash
git clone <repository-url>
cd "Act Constructor"
python -m venv .venv
source .venv/bin/activate   # Linux/Mac
# .venv\Scripts\activate    # Windows
pip install -r requirements.txt
```

Для разработки:

```bash
pip install -r requirements-dev.txt
```

### 2. Настройка окружения

Скопируйте файл конфигурации и заполните значения:

```bash
cp .env.example .env
```

Минимальная конфигурация (PostgreSQL):

```env
DATABASE__TYPE=postgresql
DATABASE__HOST=localhost
DATABASE__PORT=5432
DATABASE__NAME=audit_workstation
DATABASE__USER=postgres
DATABASE__PASSWORD=your_password
```

При работе с Greenplum:

```env
DATABASE__TYPE=greenplum
DATABASE__GP__HOST=gp_host
DATABASE__GP__PORT=5432
DATABASE__GP__DATABASE=capgp3
DATABASE__GP__SCHEMA=your_schema
DATABASE__GP__TABLE_PREFIX=t_db_oarb_audit_act_
```

> При использовании Greenplum необходимо предварительно выполнить `kinit` для Kerberos-аутентификации.

### 3. Запуск

**Режим разработки** (с горячей перезагрузкой):

```bash
python -m app.main
```

**Production** (через Uvicorn):

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Приложение будет доступно по адресу `http://localhost:8000`.

Схема базы данных создается автоматически при первом запуске.

## Конфигурация

Все настройки управляются через `.env` файл. Вложенные параметры используют `__` как разделитель.

| Группа | Переменные | Описание |
|--------|-----------|----------|
| Приложение | `APP_TITLE`, `APP_VERSION` | Метаданные |
| Сервер | `SERVER__HOST`, `SERVER__PORT`, `SERVER__LOG_LEVEL` | Параметры HTTP-сервера |
| База данных | `DATABASE__TYPE`, `DATABASE__HOST`, `DATABASE__PORT`, `DATABASE__NAME`, `DATABASE__USER`, `DATABASE__PASSWORD` | Подключение к БД |
| Greenplum | `DATABASE__GP__HOST`, `DATABASE__GP__SCHEMA`, `DATABASE__GP__TABLE_PREFIX` | Настройки GP (при `DATABASE__TYPE=greenplum`) |
| Безопасность | `SECURITY__MAX_REQUEST_SIZE`, `SECURITY__RATE_LIMIT_PER_MINUTE` | Лимиты запросов |
| AI-чат | `CHAT__API_BASE`, `CHAT__API_KEY`, `CHAT__MODEL` | OpenAI-совместимый LLM API (опционально) |
| Блокировки | `ACTS__LOCK__DURATION_MINUTES`, `ACTS__LOCK__INACTIVITY_TIMEOUT_MINUTES` | Управление блокировками актов |
| Фактуры | `ACTS__INVOICE__HIVE_SCHEMA`, `ACTS__INVOICE__GP_SCHEMA` | Схемы для привязки фактур |

Полный список переменных — в файле [.env.example](.env.example).

## Архитектура

3-уровневая архитектура с плагинной системой доменов и адаптерами для мультиБД.

```
Browser (vanilla JS)
    |
FastAPI Application
    ├── Shared API (auth, chat, system)
    ├── Domain Plugin Registry
    │   └── acts/ — CRUD, блокировки, содержимое, экспорт, фактуры, аудит-лог
    └── Database Layer
        ├── asyncpg Connection Pool
        └── Adapters (PostgreSQL | Greenplum)
```

### Backend

- **FastAPI** — HTTP-фреймворк с автоматической OpenAPI документацией
- **asyncpg** — асинхронный драйвер PostgreSQL
- **Pydantic** — валидация данных и настроек
- **python-docx** — генерация DOCX-документов

### Frontend

- **Vanilla JavaScript** (ES6+) — без фреймворков
- 3-зонная модульная архитектура: `shared/`, `portal/`, `constructor/`
- Jinja2-шаблоны с двумя независимыми базовыми шаблонами

### Структура проекта

```
app/
├── main.py                 — фабрика приложения, lifecycle
├── api/v1/                 — shared API эндпоинты (auth, chat, system)
├── core/                   — конфигурация, middleware, реестры
├── db/                     — пул подключений, адаптеры, базовый репозиторий
├── domains/
│   ├── acts/               — основной домен: акты проверок
│   │   ├── api/            — REST API (CRUD, содержимое, экспорт, фактуры, аудит-лог)
│   │   ├── services/       — бизнес-логика
│   │   ├── repositories/   — доступ к БД
│   │   ├── schemas/        — Pydantic-модели
│   │   ├── formatters/     — экспорт (TXT, MD, DOCX)
│   │   └── migrations/     — SQL-схемы (PostgreSQL, Greenplum)
│   ├── admin/              — администрирование (роли, справочник пользователей)
│   └── ...                 — другие домены-плагины (ck_fin_res, ck_client_exp)
├── schemas/                — общие модели (chat, errors)
└── formatters/             — общие утилиты форматирования
static/
├── css/                    — модульные CSS (entry/ -> base/ + shared/ + zone/)
└── js/                     — модульный JS (shared/ + portal/ + constructor/)
templates/
├── shared/                 — общие компоненты (chat, dialog, errors)
├── portal/                 — портал (landing, acts-manager)
└── constructor/            — редактор актов
```

## Основные страницы

| URL | Описание |
|-----|----------|
| `/` | Главная страница (workspace) с AI-чатом |
| `/acts` | Менеджер актов — карточки, создание, дублирование, удаление |
| `/constructor?act_id=X` | Конструктор актов — двухшаговый редактор (структура + содержимое) |
| `/admin` | Панель администрирования — управление ролями и пользователями |

## API документация

Интерактивная документация доступна после запуска:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

### Основные группы API

| Префикс | Описание |
|---------|----------|
| `/api/v1/auth/` | Авторизация (JupyterHub/Kerberos) |
| `/api/v1/chat/` | AI-ассистент с function-calling |
| `/api/v1/system/` | Health check, версия |
| `/api/v1/acts/` | CRUD актов, блокировки, метаданные |
| `/api/v1/acts/{id}/content` | Содержимое акта (дерево, таблицы, текстблоки, нарушения) |
| `/api/v1/acts/export/` | Экспорт и скачивание документов |
| `/api/v1/acts/invoices/` | Управление фактурами |
| `/api/v1/acts/{id}/audit-log` | Журнал операций и версии содержимого |
| `/api/v1/admin/` | Управление ролями и пользователями |

## Тестирование

```bash
pytest
```

Тесты используют `pytest` + `pytest-asyncio` + `httpx` (для тестирования FastAPI).

## Деплой

Приложение поддерживает деплой:

- **Standalone** — `uvicorn app.main:app`
- **За JupyterHub proxy** — автоматическая настройка `root_path` для путей вида `/user/{user}/proxy/{port}`
- **За reverse proxy** — встроенный HTTPS-redirect middleware

### Middleware

1. HTTPS Redirect (для reverse proxy)
2. Ограничение размера запросов (по умолчанию 10 МБ)
3. Rate limiting (по умолчанию 1024 запросов/мин на IP)
