"""
Тесты доменных исключений экспорта актов и their поведения в ExportService.

Покрывает:
- Классы ActExportValidationError, ActExportTimeoutError.
- Бросание правильных исключений из ExportService при ошибках форматирования и сохранения.
"""

import asyncio
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.core.exceptions import AppError
from app.domains.acts.exceptions import (
    ActExportValidationError,
    ActExportTimeoutError,
    UnsupportedFormatError,
)
from app.domains.acts.services.export_service import ExportService


# ── Юнит-тесты классов исключений ──


def test_act_export_validation_error_status_code():
    """ActExportValidationError имеет status_code=400."""
    err = ActExportValidationError("глубина дерева превышена")
    assert err.status_code == 400
    assert err.message == "глубина дерева превышена"
    assert str(err) == "глубина дерева превышена"


def test_act_export_validation_error_is_app_error():
    """ActExportValidationError — наследник AppError."""
    err = ActExportValidationError("test")
    assert isinstance(err, AppError)


def test_act_export_validation_error_to_detail():
    """ActExportValidationError.to_detail() возвращает стандартный dict."""
    err = ActExportValidationError("глубина 51 > 50")
    assert err.to_detail() == {"detail": "глубина 51 > 50"}


def test_act_export_timeout_error_status_code():
    """ActExportTimeoutError имеет status_code=408."""
    err = ActExportTimeoutError("обработка заняла слишком много времени")
    assert err.status_code == 408
    assert err.message == "обработка заняла слишком много времени"


def test_act_export_timeout_error_is_app_error():
    """ActExportTimeoutError — наследник AppError."""
    err = ActExportTimeoutError("timeout")
    assert isinstance(err, AppError)


def test_act_export_timeout_error_to_detail():
    """ActExportTimeoutError.to_detail() возвращает стандартный dict."""
    err = ActExportTimeoutError("timeout >300s")
    assert err.to_detail() == {"detail": "timeout >300s"}


# ── Хелперы для тестов ExportService ──


def _make_export_service(storage=None):
    """Создаёт ExportService с заглушками зависимостей."""
    from app.domains.acts.settings import ActsSettings
    from app.core.config import Settings
    from pathlib import Path

    mock_settings = MagicMock(spec=Settings)
    mock_settings.storage_dir = Path("/tmp/test_storage")
    acts_settings = ActsSettings()

    if storage is None:
        storage = MagicMock()
        storage.save.return_value = "act_20240101_120000_abcd.txt"
        storage.save_docx.return_value = "act_20240101_120000_abcd.docx"

    with patch("app.domains.acts.services.export_service.TextFormatter"), \
         patch("app.domains.acts.services.export_service.MarkdownFormatter"), \
         patch("app.domains.acts.services.export_service.DocxFormatter"):
        svc = ExportService(
            storage=storage,
            settings=mock_settings,
            acts_settings=acts_settings,
        )
    return svc


def _minimal_act_data() -> dict:
    return {
        "tree": {"id": "root", "label": "Акт", "children": []},
        "tables": {},
        "textBlocks": {},
        "violations": {},
    }


# ── Тесты ExportService ──


@pytest.mark.asyncio
async def test_unsupported_format_raises():
    """save_act с неподдерживаемым форматом бросает UnsupportedFormatError."""
    svc = _make_export_service()
    with pytest.raises(UnsupportedFormatError):
        await svc.save_act(_minimal_act_data(), fmt="pdf")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_formatter_ose_rror_raises_app_error():
    """OSError из форматера оборачивается в AppError."""
    svc = _make_export_service()
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.side_effect = OSError("disk error")

    with patch("app.domains.acts.services.export_service.get_executor", return_value=None):
        with pytest.raises(AppError):
            await svc.save_act(_minimal_act_data(), fmt="txt")


@pytest.mark.asyncio
async def test_formatter_memory_error_raises_app_error():
    """MemoryError из форматера оборачивается в AppError."""
    svc = _make_export_service()
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.side_effect = MemoryError("out of memory")

    with patch("app.domains.acts.services.export_service.get_executor", return_value=None):
        with pytest.raises(AppError):
            await svc.save_act(_minimal_act_data(), fmt="txt")


@pytest.mark.asyncio
async def test_storage_oserror_raises_app_error():
    """OSError из storage.save оборачивается в AppError."""
    storage = MagicMock()
    storage.save.side_effect = OSError("permission denied")
    storage.save_docx.side_effect = OSError("permission denied")

    svc = _make_export_service(storage=storage)
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.return_value = "formatted text"

    with patch("app.domains.acts.services.export_service.get_executor", return_value=None):
        with pytest.raises(AppError, match="Не удалось сохранить файл акта"):
            await svc.save_act(_minimal_act_data(), fmt="txt")


@pytest.mark.asyncio
async def test_app_error_from_formatter_propagates():
    """AppError из форматера не оборачивается повторно."""
    svc = _make_export_service()
    original = AppError("специфическая ошибка форматера")
    svc._formatters["md"] = MagicMock()
    svc._formatters["md"].format.side_effect = original

    with patch("app.domains.acts.services.export_service.get_executor", return_value=None):
        with pytest.raises(AppError) as exc_info:
            await svc.save_act(_minimal_act_data(), fmt="md")
        assert exc_info.value is original
