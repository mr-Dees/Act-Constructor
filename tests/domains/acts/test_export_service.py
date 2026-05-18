"""
Unit-тесты ExportService (happy-path и выбор форматера).

Покрывает то, что НЕ покрыто в test_export_exceptions.py:
- успешный save_act для всех трёх форматов (txt, md, docx)
- корректный выбор форматера по типу
- передача данных и вызов storage.save / storage.save_docx
- структура ActSaveResponse
- пустые данные (форматер вызывается, файл сохраняется)
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import Settings
from app.domains.acts.exceptions import UnsupportedFormatError
from app.domains.acts.schemas.act_content import ActSaveResponse
from app.domains.acts.services.export_service import ExportService
from app.domains.acts.settings import ActsSettings


# ── Хелперы ────────────────────────────────────────────────────────────────


def _make_export_service(storage=None):
    """Создаёт ExportService с заглушками форматеров и storage."""
    mock_settings = MagicMock(spec=Settings)
    mock_settings.storage_dir = Path("/tmp/test_storage_export")
    acts_settings = ActsSettings()

    if storage is None:
        storage = MagicMock()
        storage.save.return_value = "act_20260101_120000_abcd.txt"
        storage.save_docx.return_value = "act_20260101_120000_abcd.docx"

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
        "metadata": {"km_number": "КМ-01-0000001", "title": "Тестовый акт"},
    }


def _empty_act_data() -> dict:
    return {"tree": {}, "tables": {}, "textBlocks": {}, "violations": {}}


# ── Кэширование и состав форматеров ────────────────────────────────────────


def test_export_service_caches_three_formatters():
    """ExportService предкэширует именно 3 форматера: txt/md/docx."""
    svc = _make_export_service()
    assert set(svc._formatters.keys()) == {"txt", "md", "docx"}


# ── save_act: успешные сценарии ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_to_text_success():
    """save_act(fmt='txt') вызывает TextFormatter.format и storage.save."""
    storage = MagicMock()
    storage.save.return_value = "act_test.txt"
    svc = _make_export_service(storage=storage)
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.return_value = "TXT-CONTENT"

    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        result = await svc.save_act(_minimal_act_data(), fmt="txt")

    # Форматер вызван с данными акта
    svc._formatters["txt"].format.assert_called_once()
    # storage.save вызван с правильным extension
    storage.save.assert_called_once_with("TXT-CONTENT", prefix="act", extension="txt")
    storage.save_docx.assert_not_called()
    # Ответ — ActSaveResponse с filename
    assert isinstance(result, ActSaveResponse)
    assert result.status == "success"
    assert result.filename == "act_test.txt"
    assert "TXT" in result.message


@pytest.mark.asyncio
async def test_export_to_markdown_success():
    """save_act(fmt='md') использует MarkdownFormatter."""
    storage = MagicMock()
    storage.save.return_value = "act_test.md"
    svc = _make_export_service(storage=storage)
    svc._formatters["md"] = MagicMock()
    svc._formatters["md"].format.return_value = "# Markdown"

    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        result = await svc.save_act(_minimal_act_data(), fmt="md")

    svc._formatters["md"].format.assert_called_once()
    storage.save.assert_called_once_with("# Markdown", prefix="act", extension="md")
    assert result.filename == "act_test.md"
    assert "MD" in result.message


@pytest.mark.asyncio
async def test_export_to_docx_success():
    """save_act(fmt='docx') вызывает DocxFormatter и storage.save_docx (не save)."""
    storage = MagicMock()
    storage.save_docx.return_value = "act_test.docx"
    svc = _make_export_service(storage=storage)
    svc._formatters["docx"] = MagicMock()
    # DOCX-форматер возвращает bytes или объект Document — для теста любой объект
    docx_blob = b"PK\x03\x04docx-bytes"
    svc._formatters["docx"].format.return_value = docx_blob

    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        result = await svc.save_act(_minimal_act_data(), fmt="docx")

    # save_docx вызван (НЕ save) с правильным prefix
    storage.save_docx.assert_called_once_with(docx_blob, prefix="act")
    storage.save.assert_not_called()
    assert result.filename == "act_test.docx"
    assert "DOCX" in result.message


# ── Неподдерживаемый формат ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_with_invalid_format_raises():
    """save_act с неподдерживаемым форматом бросает UnsupportedFormatError."""
    svc = _make_export_service()
    with pytest.raises(UnsupportedFormatError) as exc_info:
        await svc.save_act(_minimal_act_data(), fmt="pdf")  # type: ignore[arg-type]
    # status_code 400 (по AppError-protocol)
    assert exc_info.value.status_code == 400
    # Сообщение содержит имя формата
    assert "pdf" in exc_info.value.message.lower()


@pytest.mark.asyncio
async def test_export_with_empty_format_raises():
    """Пустая строка как формат также → UnsupportedFormatError."""
    svc = _make_export_service()
    with pytest.raises(UnsupportedFormatError):
        await svc.save_act(_minimal_act_data(), fmt="")  # type: ignore[arg-type]


# ── Пустой акт / минимальные данные ────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_empty_act_still_invokes_formatter_and_storage():
    """Пустой акт (без tree/tables) корректно проходит pipeline.

    Контракт ExportService: проверка структуры данных лежит на форматере;
    сам сервис только маршрутизирует. Если форматер не упал — сохраняем.
    """
    storage = MagicMock()
    storage.save.return_value = "act_empty.txt"
    svc = _make_export_service(storage=storage)
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.return_value = ""

    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        result = await svc.save_act(_empty_act_data(), fmt="txt")

    svc._formatters["txt"].format.assert_called_once()
    storage.save.assert_called_once()
    # Пустой контент → пустая строка ушла в storage
    assert storage.save.call_args.args[0] == ""
    assert result.status == "success"


# ── Выбор форматера: txt/md/docx используют разные инстансы ─────────────────


@pytest.mark.asyncio
async def test_export_uses_correct_formatter_per_type():
    """Каждый формат вызывает только свой форматер, остальные не трогаются."""
    storage = MagicMock()
    storage.save.return_value = "x.txt"
    storage.save_docx.return_value = "x.docx"
    svc = _make_export_service(storage=storage)

    txt_mock = MagicMock()
    md_mock = MagicMock()
    docx_mock = MagicMock()
    txt_mock.format.return_value = "txt"
    md_mock.format.return_value = "md"
    docx_mock.format.return_value = b"docx"
    svc._formatters["txt"] = txt_mock
    svc._formatters["md"] = md_mock
    svc._formatters["docx"] = docx_mock

    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        await svc.save_act(_minimal_act_data(), fmt="md")

    md_mock.format.assert_called_once()
    txt_mock.format.assert_not_called()
    docx_mock.format.assert_not_called()


# ── Данные акта передаются в форматер в первозданном виде ──────────────────


@pytest.mark.asyncio
async def test_export_passes_act_data_to_formatter_unchanged():
    """ExportService не модифицирует данные перед вызовом форматера."""
    storage = MagicMock()
    storage.save.return_value = "x.txt"
    svc = _make_export_service(storage=storage)
    svc._formatters["txt"] = MagicMock()
    svc._formatters["txt"].format.return_value = "ok"

    data = _minimal_act_data()
    with patch(
        "app.domains.acts.services.export_service.get_executor",
        return_value=None,
    ):
        await svc.save_act(data, fmt="txt")

    # Первый позиционный аргумент format() — наши данные as-is
    call_args = svc._formatters["txt"].format.call_args
    passed = call_args.args[0]
    assert passed is data
    # Метаданные не вычищены, попадают форматеру для шапки
    assert passed.get("metadata", {}).get("km_number") == "КМ-01-0000001"
