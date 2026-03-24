"""
Обнаружение и регистрация доменов.

Сканирует app/domains/*/, импортирует DomainDescriptor из каждого пакета,
регистрирует роутеры и обработчики ошибок в приложении FastAPI.
"""

import importlib
import logging
from bisect import insort
from collections import deque
from pathlib import Path

from fastapi import Depends, FastAPI

from app.core.domain import DomainDescriptor

logger = logging.getLogger("act_constructor.core.domain_registry")

_domains: list[DomainDescriptor] = []
_registered_app_ids: set[int] = set()

REQUIRED_DOMAINS = {"acts"}


def discover_domains(domains_dir: Path) -> list[DomainDescriptor]:
    """
    Сканирует директорию доменов и возвращает список DomainDescriptor.

    Каждая поддиректория с __init__.py должна экспортировать атрибут `domain`.
    Результат кэшируется — повторный вызов возвращает тот же список.
    """
    global _domains

    if _domains:
        return _domains

    if not domains_dir.exists():
        logger.warning(f"Директория доменов не найдена: {domains_dir}")
        return []

    discovered = []

    for entry in sorted(domains_dir.iterdir()):
        if not entry.is_dir():
            continue
        init_file = entry / "__init__.py"
        if not init_file.exists():
            continue

        module_name = f"app.domains.{entry.name}"
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            raise RuntimeError(
                f"Не удалось импортировать домен {module_name}"
            ) from exc

        # Поддержка lazy-инициализации: _build_domain() или domain атрибут
        descriptor = getattr(module, "domain", None)
        if descriptor is None:
            build_fn = getattr(module, "_build_domain", None)
            if callable(build_fn):
                try:
                    descriptor = build_fn()
                except Exception as exc:
                    raise RuntimeError(
                        f"Не удалось собрать домен {module_name}"
                    ) from exc

        if not isinstance(descriptor, DomainDescriptor):
            logger.warning(
                f"Модуль {module_name} не содержит атрибут 'domain' типа DomainDescriptor"
            )
            continue

        if descriptor.package_path is None:
            descriptor.package_path = entry

        # Настройки загружаются ДО регистрации домена —
        # ошибка в settings блокирует запуск, а не падает при первом запросе
        if descriptor.settings_class is not None:
            from app.core.settings_registry import register
            register(descriptor.name, descriptor.settings_class)
            logger.info(f"Настройки домена {descriptor.name} загружены")

        # Регистрация chat tools
        if descriptor.chat_tools:
            from app.core.chat_tools import register_tools
            register_tools(descriptor.chat_tools)
            logger.info(
                f"Chat tools домена {descriptor.name}: "
                f"{len(descriptor.chat_tools)}"
            )

        discovered.append(descriptor)
        logger.info(f"Обнаружен домен: {descriptor.name}")

    # Проверка обязательных доменов
    discovered_names = {d.name for d in discovered}
    missing = REQUIRED_DOMAINS - discovered_names
    if missing:
        raise RuntimeError(
            f"Обязательные домены не обнаружены: {', '.join(sorted(missing))}"
        )

    # Топологическая сортировка по зависимостям
    discovered = _toposort(discovered)

    _domains = discovered
    return _domains


def _toposort(domains: list[DomainDescriptor]) -> list[DomainDescriptor]:
    """Топологическая сортировка доменов по полю dependencies."""
    name_to_domain = {d.name: d for d in domains}
    known_names = set(name_to_domain)

    # Валидация: все зависимости должны существовать
    for d in domains:
        unknown = set(d.dependencies) - known_names
        if unknown:
            raise RuntimeError(
                f"Домен '{d.name}' зависит от неизвестных доменов: "
                f"{', '.join(sorted(unknown))}"
            )

    # Алгоритм Кана
    in_degree: dict[str, int] = {d.name: 0 for d in domains}
    dependents: dict[str, list[str]] = {d.name: [] for d in domains}
    for d in domains:
        for dep in d.dependencies:
            in_degree[d.name] += 1
            dependents[dep].append(d.name)

    queue = deque(sorted(name for name, deg in in_degree.items() if deg == 0))
    result: list[DomainDescriptor] = []

    while queue:
        name = queue.popleft()
        result.append(name_to_domain[name])
        for dep_name in dependents[name]:
            in_degree[dep_name] -= 1
            if in_degree[dep_name] == 0:
                insort(queue, dep_name)

    if len(result) != len(domains):
        raise RuntimeError("Циклическая зависимость между доменами")

    return result


def register_domains(
    app: FastAPI,
    domains: list[DomainDescriptor],
    api_prefix: str,
) -> None:
    """
    Регистрирует роутеры и обработчики ошибок доменов в FastAPI приложении.
    """
    global _registered_app_ids
    app_id = id(app)
    if app_id in _registered_app_ids:
        logger.debug("Домены уже зарегистрированы в этом приложении, пропуск")
        return
    _registered_app_ids.add(app_id)

    registered_exc_classes: dict[type[Exception], str] = {}

    from app.api.v1.deps.role_deps import require_admin, require_domain_access

    for d in domains:
        # Определяем зависимости проверки ролей для домена
        if d.name == "admin":
            role_deps = [Depends(require_admin())]
        else:
            role_deps = [Depends(require_domain_access(d.name))]

        # API роутеры
        for router, prefix, tags in d.api_routers:
            full_prefix = f"{api_prefix}{prefix}"
            app.include_router(
                router, prefix=full_prefix, tags=tags,
                dependencies=role_deps,
            )
            logger.info(f"Домен {d.name}: API {full_prefix}")

        # HTML роутеры
        for router in d.html_routers:
            app.include_router(router, dependencies=role_deps)
            logger.info(f"Домен {d.name}: HTML роутер зарегистрирован")

        # Обработчики ошибок (с детекцией коллизий)
        if d.exception_handlers:
            for exc_class, handler in d.exception_handlers.items():
                if exc_class in registered_exc_classes:
                    raise RuntimeError(
                        f"Коллизия exception handler: {exc_class.__name__} "
                        f"уже зарегистрирован доменом '{registered_exc_classes[exc_class]}', "
                        f"домен '{d.name}' пытается перезаписать"
                    )
                app.add_exception_handler(exc_class, handler)
                registered_exc_classes[exc_class] = d.name
                logger.info(f"Домен {d.name}: обработчик {exc_class.__name__}")


def get_domain(name: str) -> DomainDescriptor | None:
    """Возвращает домен по имени."""
    for d in _domains:
        if d.name == name:
            return d
    return None


def get_all_domains() -> list[DomainDescriptor]:
    """Возвращает все зарегистрированные домены."""
    return list(_domains)


def reset_registry() -> None:
    """Сбрасывает реестр (для тестов)."""
    global _domains, _registered_app_ids
    _domains = []
    _registered_app_ids = set()
