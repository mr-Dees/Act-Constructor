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
DATABASE__TABLE_PREFIX=t_db_oarb_audit_act_
```

> При использовании Greenplum необходимо предварительно выполнить `kinit` для Kerberos-аутентификации.

### 3. Запуск

**Режим разработки** (с горячей перезагрузкой):

```bash
python -m app.main
```

**Production** (через Uvicorn):

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8005
```

Приложение будет доступно по адресу `http://localhost:8005` (порт берётся из `SERVER__PORT` в `.env`; в `.env.example` задан `8005`).

Схема базы данных создается автоматически при первом запуске.

> Подробнее об архитектуре, доменах, плагинной системе и интеграциях — см. [docs/developer-guide.md](docs/developer-guide.md).

## Конфигурация

Все настройки управляются через `.env` файл. Вложенные параметры используют `__` как разделитель.

| Группа | Переменные | Описание |
|--------|-----------|----------|
| Приложение | `APP_TITLE`, `APP_VERSION` | Метаданные |
| Сервер | `SERVER__HOST`, `SERVER__PORT`, `SERVER__LOG_LEVEL` | Параметры HTTP-сервера |
| База данных | `DATABASE__TYPE`, `DATABASE__HOST`, `DATABASE__PORT`, `DATABASE__NAME`, `DATABASE__USER`, `DATABASE__PASSWORD` | Подключение к БД |
| Префикс таблиц | `DATABASE__TABLE_PREFIX` | Общий префикс таблиц приложения для PG и GP (`t_db_oarb_audit_act_`) |
| Greenplum | `DATABASE__GP__HOST`, `DATABASE__GP__SCHEMA` | Настройки GP (при `DATABASE__TYPE=greenplum`) |
| Безопасность | `SECURITY__MAX_REQUEST_SIZE`, `SECURITY__RATE_LIMIT_PER_MINUTE` | Лимиты запросов |
| AI-чат | `CHAT__API_BASE`, `CHAT__API_KEY`, `CHAT__MODEL` | OpenAI-совместимый LLM API (опционально) |
| Блокировки | `ACTS__LOCK__DURATION_MINUTES`, `ACTS__LOCK__INACTIVITY_TIMEOUT_MINUTES` | Управление блокировками актов |
| Аудит-лог | `ACTS__AUDIT_LOG__RETENTION_DAYS`, `ACTS__AUDIT_LOG__MAX_DIFF_ELEMENTS` | Хранение логов и лимиты diff |
| Фактуры | `ACTS__INVOICE__HIVE_SCHEMA`, `ACTS__INVOICE__GP_SCHEMA` | Схемы для привязки фактур |
| Администрирование | `ADMIN__USER_DIRECTORY__*` | Справочник пользователей |
| ЦК Фин.Рез. | `CK_FIN_RES__SCHEMA_NAME`, `CK_FIN_RES__*` | Таблицы и VIEW верификации FR |
| ЦК Клиентский опыт | `CK_CLIENT_EXP__SCHEMA_NAME`, `CK_CLIENT_EXP__*` | Таблицы и VIEW верификации CS |
| Справочные данные | `UA_DATA__*` | Словари процессов, ТБ, подразделений |

Полный список переменных — в файле [.env.example](.env.example).

## Архитектура

3-уровневая архитектура с плагинной системой доменов и адаптерами для мультиБД.

```
Browser (vanilla JS)
    |
FastAPI Application
    ├── Shared API (auth, system, roles)
    ├── Domain Plugin Registry
    │   ├── acts/ — CRUD, блокировки, содержимое, экспорт, фактуры, аудит-лог
    │   ├── admin/ — роли, справочник пользователей
    │   ├── chat/ — AI-ассистент (SSE-стриминг, conversation persistence, function-calling)
    │   ├── ck_*/ — верификация метрик (ck_fin_res, ck_client_exp)
    │   └── ua_data/ — справочные данные УА (словари процессов, ТБ, подразделений)
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
- Чат-система: event-driven архитектура из 11 ядерных модулей в `shared/chat/` (EventBus, UI, Files, Context, Messages, Manager, Stream, Renderer, History, Modal, ClientActions) + региональный `ChatPopupManager` в `constructor/header/`

### Структура проекта

```
app/
├── main.py                 — фабрика приложения, lifecycle
├── api/v1/                 — shared API эндпоинты (auth, system, roles)
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
│   ├── chat/               — AI-ассистент (conversations, messages, files, actions)
│   ├── ck_fin_res/         — ЦК Финансовый результат (верификация метрик FR)
│   ├── ck_client_exp/      — ЦК Клиентский опыт (верификация метрик CS)
│   └── ua_data/            — справочники УА (процессы, ТБ, подразделения)
├── schemas/                — общие модели (errors)
└── formatters/             — общие утилиты форматирования
static/
├── css/                    — модульные CSS (entry/ -> base/ + shared/ + zone/)
└── js/                     — модульный JS (shared/ + portal/ + constructor/)
    └── shared/chat/        — 11 ядерных модулей: event-bus, ui, files, context, messages, manager, stream, renderer, history, modal, client-actions
                              (12-й — constructor/header/chat-popup.js, региональный)
templates/
├── shared/                 — общие компоненты (chat, dialog, errors)
├── portal/                 — портал (landing, acts-manager)
└── constructor/            — редактор актов
```

## Основные страницы

| URL | Описание |
|-----|----------|
| `/` | Главная страница (workspace) с AI-чатом |
| `/acts` | Менеджер актов — карточки, создание (с autocomplete участников), дублирование, удаление |
| `/constructor?act_id=X` | Конструктор актов — двухшаговый редактор (структура + содержимое) |
| `/admin` | Панель администрирования — управление ролями и пользователями |
| `/ck-fin-res` | ЦК Фин.Рез. — верификация метрик финансового результата |
| `/ck-client-experience` | ЦК Клиентский опыт — верификация метрик клиентского опыта |

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
| `/api/v1/acts/invoice/` | Управление фактурами |
| `/api/v1/acts/{id}/audit-log` | Журнал операций и версии содержимого |
| `/api/v1/acts/users/` | Поиск пользователей для аудиторской группы |
| `/api/v1/admin/` | Управление ролями и пользователями |
| `/api/v1/ck-fin-res/` | ЦК Фин.Рез. — CRUD записей FR-валидации, справочники |
| `/api/v1/ck-client-exp/` | ЦК Клиентский опыт — CRUD записей CS-валидации, справочники |

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

1. RequestId — генерация уникального ID для каждого запроса
2. Rate limiting (по умолчанию 1024 запросов/мин на IP)
3. Ограничение размера запросов (по умолчанию 10 МБ)
4. HTTPS Redirect (для reverse proxy)
