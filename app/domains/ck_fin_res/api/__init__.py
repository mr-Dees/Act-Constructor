"""API роутеры домена ЦК Фин.Рез."""

from app.domains.ck_fin_res.api.records import router as records_router
from app.domains.ck_fin_res.api.dictionaries import router as dictionaries_router


def get_api_routers():
    """Возвращает список API роутеров домена ЦК Фин.Рез."""
    return [
        (records_router, "/ck-fin-res", ["ЦК Фин.Рез."]),
        (dictionaries_router, "/ck-fin-res", ["ЦК Фин.Рез. Справочники"]),
    ]
