"""Тесты конфигурации профилей и retry/agent_bridge."""
import pytest

from app.core.settings_registry import _load_from_env, reset
from app.domains.chat.settings import ChatDomainSettings


def _env(monkeypatch, **vars):
    """Хелпер: проставить env-переменные для одного теста."""
    for k, v in vars.items():
        monkeypatch.setenv(k, v)


@pytest.fixture(autouse=True)
def _reset_registry():
    reset()
    yield
    reset()


def _load(monkeypatch, **env_vars) -> ChatDomainSettings:
    _env(monkeypatch, **env_vars)
    return _load_from_env("chat", ChatDomainSettings)


def test_default_profile_is_sglang():
    # Прямое инстанцирование, чтобы тест документировал ДЕФОЛТЫ КЛАССА,
    # а не текущее содержимое пользовательского .env (где у разработчика
    # может стоять CHAT__PROFILE=openrouter).
    s = ChatDomainSettings(
        api_base="http://localhost:30000/v1", api_key="dummy", model="m",
    )
    assert s.profile == "sglang"
    assert s.retry.on_429 is True
    assert s.retry.on_5xx is True
    assert s.smalltalk_mode == "local"
    assert s.agent_bridge.poll_interval_sec == 1.0


def test_openrouter_profile_with_extra_headers():
    # Прямое инстанцирование, чтобы headers из пользовательского .env
    # (X-Title и т.п.) не вмешивались в проверку парсинга dict.
    s = ChatDomainSettings(
        profile="openrouter",
        api_base="https://openrouter.ai/api/v1",
        api_key="sk-or-x",
        model="minimax/minimax-m2:free",
        extra_headers={"HTTP-Referer": "https://aw.local"},
    )
    assert s.profile == "openrouter"
    assert s.extra_headers == {"HTTP-Referer": "https://aw.local"}


def test_nested_retry_overrides(monkeypatch):
    s = _load(monkeypatch,
              CHAT__API_BASE="http://x", CHAT__API_KEY="x", CHAT__MODEL="m",
              CHAT__RETRY__ON_429="false",
              CHAT__RETRY__ON_5XX="true",
              CHAT__RETRY__MAX_ATTEMPTS="3",
              CHAT__RETRY__BACKOFF_BASE_SEC="0.5")
    assert s.retry.on_429 is False
    assert s.retry.on_5xx is True
    assert s.retry.max_attempts == 3
    assert s.retry.backoff_base_sec == 0.5


def test_nested_agent_bridge_overrides(monkeypatch):
    s = _load(monkeypatch,
              CHAT__API_BASE="http://x", CHAT__API_KEY="x", CHAT__MODEL="m",
              CHAT__AGENT_BRIDGE__POLL_INTERVAL_SEC="0.25",
              CHAT__AGENT_BRIDGE__INITIAL_RESPONSE_TIMEOUT_SEC="60",
              CHAT__AGENT_BRIDGE__EVENT_TIMEOUT_SEC="30",
              CHAT__AGENT_BRIDGE__MAX_TOTAL_DURATION_SEC="900",
              CHAT__AGENT_BRIDGE__HISTORY_LIMIT="10")
    assert s.agent_bridge.poll_interval_sec == 0.25
    assert s.agent_bridge.initial_response_timeout_sec == 60
    assert s.agent_bridge.event_timeout_sec == 30
    assert s.agent_bridge.max_total_duration_sec == 900
    assert s.agent_bridge.history_limit == 10


def test_smalltalk_mode_forward(monkeypatch):
    s = _load(monkeypatch,
              CHAT__API_BASE="http://x", CHAT__API_KEY="x", CHAT__MODEL="m",
              CHAT__SMALLTALK_MODE="forward")
    assert s.smalltalk_mode == "forward"


def test_gigachat_profile_accepted():
    """Профиль gigachat должен валидно создаваться."""
    s = ChatDomainSettings(
        profile="gigachat",
        api_base="http://liveaccess/v1/gc",
        api_key="dummy-token",
        model="GigaChat-3-Ultra",
    )
    assert s.profile == "gigachat"


def test_invalid_profile_rejected():
    """Литерал отвергает значения вне whitelist'а."""
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        ChatDomainSettings(
            profile="anthropic",  # нет в Literal
            api_base="http://x",
            api_key="x",
            model="m",
        )
