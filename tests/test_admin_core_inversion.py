"""Регрессия: core не зависит от admin-домена напрямую (инверсия через реестр фабрик).

Закрывает две протечки инверсии, при которых core импортировал admin напрямую:
- ``app/main.py`` — HTTP-метрики (``admin.deps.get_http_metrics_service``);
- ``app/api/v1/deps/role_deps.py`` — аудит отказов доступа.

Теперь связь идёт через ``domain_registry`` фабрики ``admin.http_metrics_service``
и ``admin.access_denied_audit``. Тест на отсутствие прямого импорта — лёгкий аналог
будущего ``import-linter`` independence-контракта.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from app.core import domain_registry
from app.domains.admin import deps as admin_deps
from app.domains.admin._lifecycle import register_factories

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _isolate_registry():
    """Сброс реестра фабрик и ссылки на батчер до и после теста."""
    domain_registry.reset_registry()
    yield
    admin_deps.set_access_denied_audit_batcher(None)
    domain_registry.reset_registry()


# -------------------------------------------------------------------------
# Главная регрессия: core-слой не импортирует домены напрямую
# -------------------------------------------------------------------------

# core-слой (фреймворк/инфраструктура) не должен зависеть ни от одного домена:
# связь с доменами идёт только через domain_registry.get_factory(...).
_CORE_FILES = ("app/main.py",)
_CORE_DIRS = ("app/core", "app/api", "app/db")
# Матчим реальный импорт (с начала строки, допуская отступ function-local
# импорта), а не упоминание в комментарии/строке.
_DOMAIN_IMPORT_RE = re.compile(
    r"^[ \t]*(?:from|import)[ \t]+app\.domains\b", re.MULTILINE
)


def _iter_core_py_files():
    for rel in _CORE_FILES:
        yield _PROJECT_ROOT / rel
    for rel_dir in _CORE_DIRS:
        yield from (_PROJECT_ROOT / rel_dir).rglob("*.py")


def test_core_layer_does_not_import_domains():
    """core/api/db и main.py не импортируют ни один домен (граница инверсии).

    Лёгкий аналог import-linter independence-контракта: любой прямой
    ``from app.domains...`` / ``import app.domains...`` в core-слое — нарушение.
    Доменные связи в core идут только через ``domain_registry.get_factory(...)``.
    """
    violations: list[str] = []
    for path in _iter_core_py_files():
        text = path.read_text(encoding="utf-8")
        for match in _DOMAIN_IMPORT_RE.finditer(text):
            line_no = text.count("\n", 0, match.start()) + 1
            rel = path.relative_to(_PROJECT_ROOT).as_posix()
            violations.append(f"{rel}:{line_no}: {match.group().strip()}")

    assert not violations, (
        "core-слой импортирует домены напрямую (нарушение инверсии) — "
        "связь должна идти через domain_registry.get_factory(...):\n"
        + "\n".join(violations)
    )


# -------------------------------------------------------------------------
# Фабрики зарегистрированы
# -------------------------------------------------------------------------

def test_register_factories_registers_inversion_factories():
    register_factories()
    assert domain_registry.has_factory("admin.http_metrics_service")
    assert domain_registry.has_factory("admin.access_denied_audit")


# -------------------------------------------------------------------------
# admin.http_metrics_service — функциональная проверка
# -------------------------------------------------------------------------

def test_http_metrics_factory_returns_service_when_enabled(monkeypatch):
    """http_metrics_enabled=True → фабрика отдаёт HttpMetricsService."""
    from app.core import settings_registry
    from app.domains.admin.services.http_metrics_service import HttpMetricsService
    from app.domains.admin.settings import AdminSettings

    # Фабрика лениво импортирует settings_registry.get при вызове — патч подхватится.
    monkeypatch.setattr(
        settings_registry,
        "get",
        lambda name, cls=None: AdminSettings(http_metrics_enabled=True),
    )
    register_factories()

    service = domain_registry.get_factory("admin.http_metrics_service")()
    assert isinstance(service, HttpMetricsService)


def test_http_metrics_factory_returns_none_when_disabled(monkeypatch):
    """http_metrics_enabled=False → фабрика отдаёт None (метрики выключены)."""
    from app.core import settings_registry
    from app.domains.admin.settings import AdminSettings

    monkeypatch.setattr(
        settings_registry,
        "get",
        lambda name, cls=None: AdminSettings(http_metrics_enabled=False),
    )
    register_factories()

    assert domain_registry.get_factory("admin.http_metrics_service")() is None


# -------------------------------------------------------------------------
# admin.access_denied_audit — функциональная проверка
# -------------------------------------------------------------------------

async def test_access_denied_factory_records_via_batcher():
    """Когда батчер поднят — фабрика пишет AccessDeniedRecord с переданными полями."""
    register_factories()

    added: list = []

    class _FakeBatcher:
        async def add(self, record):
            added.append(record)

    admin_deps.set_access_denied_audit_batcher(_FakeBatcher())

    record_denied = domain_registry.get_factory("admin.access_denied_audit")()
    recorded = await record_denied(
        username="22222222",
        domain="acts",
        path="/api/v1/acts",
        method="GET",
        reason="roles=[<none>], missing domain_name='acts'",
    )

    assert recorded is True
    assert len(added) == 1
    assert added[0].username == "22222222"
    assert added[0].domain == "acts"
    assert added[0].path == "/api/v1/acts"
    assert added[0].method == "GET"


async def test_access_denied_factory_graceful_without_batcher():
    """Без поднятого батчера фабрика не падает (403 не должен ломаться)."""
    register_factories()
    admin_deps.set_access_denied_audit_batcher(None)

    record_denied = domain_registry.get_factory("admin.access_denied_audit")()
    # Без батчера — возвращает False (core залогирует warning), не падает.
    recorded = await record_denied(
        username="22222222",
        domain="acts",
        path="/api/v1/acts",
        method="GET",
        reason="r",
    )

    assert recorded is False
