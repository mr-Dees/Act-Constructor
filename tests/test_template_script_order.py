"""Снапшот порядка <script>-тегов в базовых шаблонах.

Порядок загрузки frontend-модулей критичен — нет бандлера, всё на window-globals.
Этот тест фиксирует инварианты, которые ломаются при бездумной перестановке тегов:

* `app-config.js` должен быть первым (используется всеми).
* `dompurify` (`purify.min.js`) — до `chat-renderer.js` (renderer вызывает SafeHTML).
* `chat-event-bus.js` — раньше всех остальных chat-модулей (они подписываются на module-level).
* `chat-stream.js` — раньше `chat-messages.js` (messages дёргает stream).
* `chat-history.js` — раньше `chat-context.js` (context использует history).
* `chat-context.js` — раньше `chat-messages.js` (messages читает context).

Тест работает на тексте шаблонов (regex), без рендеринга Jinja —
блокам `{% include %}` доверяем, что они не вставляют свои <script>-теги в чат-блок.
"""

import re
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Сначала находим тег <script ...> целиком (с переносами), потом из его src/path
# вытаскиваем basename — это надёжнее, чем один большой regex по сырому HTML с
# вложенными кавычками `src="{{ url_for('static', path='...') }}"`.
_SCRIPT_TAG_RE = re.compile(r"<script\b[^>]*?>", re.IGNORECASE | re.DOTALL)
# Имя файла перед `.js` или `.min.js` — берём всё до последнего `/` и до `.js`.
_BASENAME_RE = re.compile(
    r"""(?:src|path)\s*=\s*['"][^'"]*?/(?P<name>[\w\-\.]+?)\.(?:min\.js|js)\b""",
    re.IGNORECASE,
)


def _extract_script_names(html: str) -> list[str]:
    """Возвращает basename'ы скриптов в порядке появления в шаблоне."""
    names: list[str] = []
    for tag in _SCRIPT_TAG_RE.finditer(html):
        m = _BASENAME_RE.search(tag.group(0))
        if m:
            names.append(m.group("name"))
    return names


def _assert_before(names: list[str], earlier: str, later: str, where: str) -> None:
    assert earlier in names, f"{where}: ожидался скрипт '{earlier}' в списке, есть: {names}"
    assert later in names, f"{where}: ожидался скрипт '{later}' в списке, есть: {names}"
    assert names.index(earlier) < names.index(later), (
        f"{where}: '{earlier}' должен идти ДО '{later}', "
        f"но индексы: {earlier}={names.index(earlier)}, {later}={names.index(later)}"
    )


@pytest.fixture(scope="module")
def base_constructor_scripts() -> list[str]:
    html = (PROJECT_ROOT / "templates" / "constructor" / "base_constructor.html").read_text(
        encoding="utf-8"
    )
    return _extract_script_names(html)


@pytest.fixture(scope="module")
def base_portal_scripts() -> list[str]:
    html = (PROJECT_ROOT / "templates" / "portal" / "base_portal.html").read_text(encoding="utf-8")
    return _extract_script_names(html)


# ---- base_constructor.html ------------------------------------------------


def test_constructor_app_config_loaded_first(base_constructor_scripts: list[str]) -> None:
    assert "app-config" in base_constructor_scripts
    # auth.js идёт сразу после app-config — оба загружаются sync, без defer
    assert base_constructor_scripts.index("app-config") < base_constructor_scripts.index("auth")
    # До app-config никаких прикладных скриптов
    assert base_constructor_scripts[0] == "app-config", (
        f"app-config.js должен быть первым, реально первый: {base_constructor_scripts[0]}"
    )


def test_constructor_dompurify_before_chat_renderer(base_constructor_scripts: list[str]) -> None:
    _assert_before(base_constructor_scripts, "purify", "chat-renderer", "base_constructor")


def test_constructor_chat_event_bus_first_in_chat(base_constructor_scripts: list[str]) -> None:
    chat_modules = [
        "chat-renderer",
        "chat-client-actions",
        "chat-stream",
        "chat-history",
        "chat-ui",
        "chat-files",
        "chat-title",
        "chat-context",
        "chat-messages",
        "chat-manager",
    ]
    assert "chat-event-bus" in base_constructor_scripts
    bus_idx = base_constructor_scripts.index("chat-event-bus")
    for mod in chat_modules:
        if mod in base_constructor_scripts:
            assert bus_idx < base_constructor_scripts.index(mod), (
                f"chat-event-bus должен идти ДО '{mod}'"
            )


def test_constructor_chat_stream_before_messages(base_constructor_scripts: list[str]) -> None:
    _assert_before(base_constructor_scripts, "chat-stream", "chat-messages", "base_constructor")


def test_constructor_chat_history_before_context(base_constructor_scripts: list[str]) -> None:
    _assert_before(base_constructor_scripts, "chat-history", "chat-context", "base_constructor")


def test_constructor_chat_context_before_messages(base_constructor_scripts: list[str]) -> None:
    _assert_before(base_constructor_scripts, "chat-context", "chat-messages", "base_constructor")


# ---- base_portal.html -----------------------------------------------------


def test_portal_app_config_loaded_first(base_portal_scripts: list[str]) -> None:
    assert "app-config" in base_portal_scripts
    assert base_portal_scripts[0] == "app-config", (
        f"app-config.js должен быть первым, реально первый: {base_portal_scripts[0]}"
    )


def test_portal_dompurify_before_chat_renderer(base_portal_scripts: list[str]) -> None:
    _assert_before(base_portal_scripts, "purify", "chat-renderer", "base_portal")


def test_portal_chat_event_bus_first_in_chat(base_portal_scripts: list[str]) -> None:
    chat_modules = [
        "chat-renderer",
        "chat-client-actions",
        "chat-stream",
        "chat-history",
        "chat-ui",
        "chat-files",
        "chat-title",
        "chat-context",
        "chat-messages",
        "chat-manager",
        "chat-modal",
    ]
    assert "chat-event-bus" in base_portal_scripts
    bus_idx = base_portal_scripts.index("chat-event-bus")
    for mod in chat_modules:
        if mod in base_portal_scripts:
            assert bus_idx < base_portal_scripts.index(mod), (
                f"chat-event-bus должен идти ДО '{mod}'"
            )


def test_portal_chat_stream_before_messages(base_portal_scripts: list[str]) -> None:
    _assert_before(base_portal_scripts, "chat-stream", "chat-messages", "base_portal")


def test_portal_chat_history_before_context(base_portal_scripts: list[str]) -> None:
    _assert_before(base_portal_scripts, "chat-history", "chat-context", "base_portal")


def test_portal_chat_context_before_messages(base_portal_scripts: list[str]) -> None:
    _assert_before(base_portal_scripts, "chat-context", "chat-messages", "base_portal")
