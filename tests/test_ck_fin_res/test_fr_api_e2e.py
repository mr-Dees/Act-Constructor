"""E2E групповых endpoints ЦКФР: мини-приложение, сервис на моках."""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.deps.auth_deps import get_username
from app.domains.ck_fin_res.api.records import _access, router
from app.domains.ck_fin_res.deps import get_fr_validation_service
from app.domains.ck_fin_res.exceptions import FRGroupConflictError


@pytest.fixture()
def client_and_service():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/ck-fin-res")
    service = AsyncMock()
    app.dependency_overrides[get_fr_validation_service] = lambda: service
    app.dependency_overrides[get_username] = lambda: "12345"
    app.dependency_overrides[_access.dependency] = lambda: None
    return TestClient(app, raise_server_exceptions=False), service


def _save_body() -> dict:
    return {
        "group_key": {"act_sub_number_id": 1, "km_id": "КМ-09-41726",
                      "act_item_number": "5.1.1", "metric_code": "2002"},
        "expected_row_ids": [101, 102],
        "common": {"metric_code": "2002"},
        "breakdown": [
            {"neg_finder_tb_id": "7", "metric_amount_rubles": "980000.00",
             "metric_element_counts": 8},
        ],
    }


def test_search_returns_groups(client_and_service):
    client, service = client_and_service
    service.search.return_value = {"items": [{"tb_count": 2}], "total": 1, "limit": 50, "offset": 0}
    resp = client.post("/api/v1/ck-fin-res/records/search", json={"filters": {}, "limit": 50, "offset": 0})
    assert resp.status_code == 200
    assert resp.json()["items"][0]["tb_count"] == 2


def test_group_save_ok(client_and_service):
    client, service = client_and_service
    service.group_save.return_value = {"deactivated": 1, "inserted": 1, "skipped": 1}
    resp = client.post("/api/v1/ck-fin-res/records/group-save", json=_save_body())
    assert resp.status_code == 200
    assert resp.json() == {"deactivated": 1, "inserted": 1, "skipped": 1}


def test_group_save_conflict_maps_to_409(client_and_service):
    client, service = client_and_service
    service.group_save.side_effect = FRGroupConflictError("конфликт")
    resp = client.post("/api/v1/ck-fin-res/records/group-save", json=_save_body())
    assert resp.status_code == 409


def test_group_save_empty_breakdown_is_422(client_and_service):
    client, _ = client_and_service
    body = _save_body()
    body["breakdown"] = []
    resp = client.post("/api/v1/ck-fin-res/records/group-save", json=body)
    assert resp.status_code == 422


def test_group_delete_ok(client_and_service):
    client, service = client_and_service
    service.group_delete.return_value = 2
    resp = client.post("/api/v1/ck-fin-res/records/group-delete", json={
        "group_key": _save_body()["group_key"], "expected_row_ids": [101, 102],
    })
    assert resp.status_code == 200
    assert resp.json() == {"deleted": 2}


def test_old_endpoints_removed(client_and_service):
    client, _ = client_and_service
    assert client.post("/api/v1/ck-fin-res/records", json={"metric_code": "1"}).status_code in (404, 405)
    # "batch-update" структурно совпадает с путём GET /records/{record_id} (без
    # :int-конвертера, как и весь остальной путь в домене) — Starlette матчит
    # его как record_id="batch-update" и отвечает 405 (Allow: GET), а не 404.
    assert client.post("/api/v1/ck-fin-res/records/batch-update", json=[]).status_code in (404, 405)
    assert client.delete("/api/v1/ck-fin-res/records/1").status_code == 405
