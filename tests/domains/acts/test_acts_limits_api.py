"""
Тесты ImagesSettings и эндпоинта GET /api/v1/acts/limits.

Эндпоинт отдаёт фронту лимиты картинок нарушений (настройки ACTS__IMAGES__*)
и жёсткие границы таблиц/текстблоков из констант схем — чтобы UI-валидация
совпадала с серверной (образец — chat GET /limits).

E2E-паттерн: минимальный FastAPI + dependency_overrides, без create_app().
Дефолты настроек проверяются прямым инстанцированием модели (не _load_from_env,
который подсасывает реальный .env).
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.deps.auth_deps import get_username
from app.domains.acts.api import get_api_routers
from app.domains.acts.deps import _get_acts_settings
from app.domains.acts.schemas.act_content import (
    FONT_SIZE_MAX,
    FONT_SIZE_MIN,
    TABLE_MAX_COLS,
    TABLE_MAX_ROWS,
    VIOLATION_IMAGE_URL_MAX_LENGTH,
)
from app.domains.acts.settings import ActsSettings, ImagesSettings


USERNAME = "12345"


# ── ImagesSettings: дефолты ─────────────────────────────────────────────────


class TestImagesSettingsDefaults:
    """Дефолты лимитов картинок нарушений."""

    def test_defaults(self):
        s = ImagesSettings()
        assert s.max_file_size == 10 * 1024 * 1024
        assert s.max_total_size_per_act == 30 * 1024 * 1024
        assert s.allowed_mime_types == [
            "image/jpeg", "image/png", "image/gif", "image/webp",
        ]
        assert s.max_items_per_violation == 50
        assert s.preview_max_height_percent == 40

    def test_acts_settings_includes_images(self):
        s = ActsSettings()
        assert isinstance(s.images, ImagesSettings)
        assert s.images.max_file_size == 10 * 1024 * 1024

    def test_url_max_length_covers_max_file_size_in_base64(self):
        """Инвариант согласованности лимитов (fce3e4e ↔ ImagesSettings).

        Серверный потолок длины data-URL (VIOLATION_IMAGE_URL_MAX_LENGTH)
        обязан быть заведомо выше UX-лимита файла: base64 раздувает байты
        в ×4/3 плюс префикс data:image/...;base64, — иначе валидный по
        max_file_size файл отбивался бы схемой.
        """
        s = ImagesSettings()
        base64_len = (s.max_file_size + 2) // 3 * 4
        prefix_margin = 64  # запас на data:image/jpeg;base64, и подобные
        assert VIOLATION_IMAGE_URL_MAX_LENGTH > base64_len + prefix_margin

    def test_mime_whitelist_matches_schema_url_whitelist(self):
        """MIME-whitelist настроек согласован с regex-whitelist'ом схемы url."""
        from app.domains.acts.schemas.act_content import _IMAGE_DATA_URL_RE
        s = ImagesSettings()
        for mime in s.allowed_mime_types:
            subtype = mime.split("/", 1)[1]
            assert _IMAGE_DATA_URL_RE.match(f"data:image/{subtype};base64,AAAA"), (
                f"MIME {mime} разрешён настройками, но отбивается схемой url"
            )


# ── GET /api/v1/acts/limits ─────────────────────────────────────────────────


def _build_app() -> FastAPI:
    """Все acts-роутеры в боевом порядке get_api_routers().

    Порядок важен: литеральный маршрут /limits обязан регистрироваться
    раньше GET /{act_id} (int) из management-роутера — иначе "limits"
    уходит в int-конвертацию act_id и даёт 422 без fallthrough.
    """
    app = FastAPI()
    for router, prefix, _tags in get_api_routers():
        app.include_router(router, prefix=f"/api/v1{prefix}")
    app.dependency_overrides[get_username] = lambda: USERNAME
    app.dependency_overrides[_get_acts_settings] = lambda: ActsSettings()
    return app


class TestActsLimitsEndpoint:
    """E2E: эндпоинт лимитов контента актов."""

    def test_returns_images_limits_and_schema_bounds(self):
        app = _build_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/acts/limits")

        assert resp.status_code == 200, resp.text
        body = resp.json()

        assert body["images"] == {
            "max_file_size": 10 * 1024 * 1024,
            "max_total_size_per_act": 30 * 1024 * 1024,
            "allowed_mime_types": [
                "image/jpeg", "image/png", "image/gif", "image/webp",
            ],
            "max_items_per_violation": 50,
            "preview_max_height_percent": 40,
        }
        # Границы таблиц/шрифта — из констант схем, не независимый хардкод
        assert body["tables"] == {
            "max_rows": TABLE_MAX_ROWS,
            "max_cols": TABLE_MAX_COLS,
        }
        assert body["textblocks"] == {
            "font_size_min": FONT_SIZE_MIN,
            "font_size_max": FONT_SIZE_MAX,
        }
        # Фактические значения границ (пин против случайной правки констант)
        assert body["tables"] == {"max_rows": 64, "max_cols": 16}
        assert body["textblocks"] == {"font_size_min": 8, "font_size_max": 72}

    def test_limits_not_shadowed_by_act_id_route(self):
        """Регрессия порядка роутеров: /limits не перехвачен /{act_id}."""
        app = _build_app()
        with TestClient(app) as client:
            resp = client.get("/api/v1/acts/limits")
        # 422 означал бы int-парсинг "limits" как act_id
        assert resp.status_code != 422
        assert resp.status_code == 200
