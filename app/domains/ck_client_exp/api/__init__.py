"""API роутеры домена ЦК Клиентский опыт."""

from app.domains.ck_client_exp.api.records import router as records_router
from app.domains.ck_client_exp.api.dictionaries import router as dictionaries_router


def get_api_routers():
    """Возвращает список API роутеров домена ЦК Клиентский опыт."""
    return [
        (records_router, "/ck-client-exp", ["ЦК Клиентский опыт"]),
        (dictionaries_router, "/ck-client-exp", ["ЦК Клиентский опыт Справочники"]),
    ]
