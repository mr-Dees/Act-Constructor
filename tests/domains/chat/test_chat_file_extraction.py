"""Тесты извлечения текста из файлов для контекста LLM.

Покрывает: каждый формат (text, PDF, Excel, Word, image),
фолбек кодировок, обрезку по лимиту, обработку повреждённых файлов,
грейсфул-деградацию при отсутствии библиотек.
"""

import io
from unittest.mock import MagicMock, patch

import pytest

from app.core.chat.tools import reset as reset_tools
from app.core.domain_registry import reset_registry
from app.core.settings_registry import reset as reset_settings
from app.core.chat.buttons import reset_action_handlers
from app.domains.chat.services.file_extraction import (
    MAX_EXTRACTED_CHARS,
    _extract_docx,
    _extract_excel,
    _extract_pdf,
    _extract_plain_text,
    _truncate,
    extract_text,
)


# -------------------------------------------------------------------------
# Фикстуры
# -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registries():
    """Сброс глобального состояния реестров между тестами."""
    reset_registry()
    reset_settings()
    reset_tools()
    reset_action_handlers()
    yield
    reset_registry()
    reset_settings()
    reset_tools()
    reset_action_handlers()


# -------------------------------------------------------------------------
# Маршрутизация по MIME-типу
# -------------------------------------------------------------------------


class TestExtractTextRouting:

    def test_text_plain(self):
        """text/plain маршрутизируется на _extract_plain_text."""
        result = extract_text(b"Hello", "text/plain", "test.txt")
        assert result == "Hello"

    def test_text_csv(self):
        """text/csv маршрутизируется на _extract_plain_text."""
        result = extract_text(b"a,b,c\n1,2,3", "text/csv", "data.csv")
        assert "a,b,c" in result

    def test_text_html(self):
        """text/html маршрутизируется на _extract_plain_text."""
        result = extract_text(b"<html><body>Test</body></html>", "text/html", "page.html")
        assert "Test" in result

    def test_image_returns_placeholder(self):
        """Изображение возвращает placeholder."""
        result = extract_text(b"\x89PNG", "image/png", "photo.png")
        assert "[Изображение: photo.png]" == result

    def test_image_jpeg(self):
        """JPEG изображение возвращает placeholder."""
        result = extract_text(b"\xff\xd8\xff", "image/jpeg", "photo.jpg")
        assert "Изображение" in result
        assert "photo.jpg" in result

    def test_unsupported_mime_type(self):
        """Неподдерживаемый MIME-тип возвращает сообщение."""
        result = extract_text(b"data", "application/zip", "archive.zip")
        assert "не поддерживается" in result
        assert "archive.zip" in result

    def test_application_octet_stream(self):
        """application/octet-stream не поддерживается."""
        result = extract_text(b"binary", "application/octet-stream", "file.bin")
        assert "не поддерживается" in result

    def test_extraction_error_handled(self):
        """Ошибка извлечения возвращает сообщение, не падает."""
        with patch(
            "app.domains.chat.services.file_extraction._extract_plain_text",
            side_effect=RuntimeError("Неожиданная ошибка"),
        ):
            result = extract_text(b"data", "text/plain", "test.txt")
        assert "Ошибка чтения" in result
        assert "test.txt" in result


# -------------------------------------------------------------------------
# Извлечение из текстовых файлов
# -------------------------------------------------------------------------


class TestExtractPlainText:

    def test_utf8_text(self):
        """UTF-8 текст декодируется корректно."""
        text = "Привет мир! Hello world!"
        result = _extract_plain_text(text.encode("utf-8"), "test.txt")
        assert result == text

    def test_cp1251_fallback(self):
        """CP-1251 (Windows-1251) текст декодируется при фолбеке."""
        text = "Привет мир!"
        data = text.encode("cp1251")
        result = _extract_plain_text(data, "test.txt")
        # Должен декодироваться через cp1251 фолбек
        assert "Привет" in result

    def test_latin1_fallback(self):
        """Latin-1 — последний фолбек, принимает любые байты."""
        # Байты, невалидные для UTF-8 и CP-1251
        data = bytes(range(128, 256))
        result = _extract_plain_text(data, "binary.txt")
        # Latin-1 принимает все однобайтовые значения
        assert len(result) > 0

    def test_encoding_order_utf8_first(self):
        """UTF-8 пробуется первым."""
        text = "ASCII text"
        data = text.encode("utf-8")
        result = _extract_plain_text(data, "ascii.txt")
        assert result == text

    def test_empty_text_file(self):
        """Пустой текстовый файл."""
        result = _extract_plain_text(b"", "empty.txt")
        assert result == ""

    def test_text_with_bom(self):
        """UTF-8 с BOM обрабатывается."""
        text = "Текст с BOM"
        data = b"\xef\xbb\xbf" + text.encode("utf-8")
        result = _extract_plain_text(data, "bom.txt")
        assert "Текст с BOM" in result


# -------------------------------------------------------------------------
# Обрезка текста (_truncate)
# -------------------------------------------------------------------------


class TestTruncation:

    def test_short_text_not_truncated(self):
        """Текст короче лимита не обрезается."""
        text = "Короткий текст"
        result = _truncate(text, "file.txt")
        assert result == text

    def test_exact_limit_not_truncated(self):
        """Текст ровно на лимите не обрезается."""
        text = "x" * MAX_EXTRACTED_CHARS
        result = _truncate(text, "exact.txt")
        assert result == text

    def test_over_limit_truncated(self):
        """Текст длиннее лимита обрезается с пометкой."""
        text = "A" * (MAX_EXTRACTED_CHARS + 1000)
        result = _truncate(text, "long.txt")
        assert len(result) > MAX_EXTRACTED_CHARS  # с учётом пометки
        assert f"{MAX_EXTRACTED_CHARS} символов" in result
        assert "long.txt" in result
        assert "обрезан" in result

    def test_truncation_preserves_start(self):
        """Обрезка сохраняет начало текста."""
        text = "НАЧАЛО" + "x" * MAX_EXTRACTED_CHARS
        result = _truncate(text, "file.txt")
        assert result.startswith("НАЧАЛО")


# -------------------------------------------------------------------------
# Извлечение из PDF
# -------------------------------------------------------------------------


class TestExtractPDF:

    def test_pdf_missing_library(self):
        """Без pypdf возвращается сообщение об установке."""
        with patch.dict("sys.modules", {"pypdf": None}):
            # Имитируем ImportError через подмену __import__
            import builtins
            original_import = builtins.__import__

            def mock_import(name, *args, **kwargs):
                if name == "pypdf":
                    raise ImportError("No module named 'pypdf'")
                return original_import(name, *args, **kwargs)

            with patch("builtins.__import__", side_effect=mock_import):
                result = _extract_pdf(b"fake pdf", "report.pdf")

        assert "pip install pypdf" in result
        assert "report.pdf" in result

    def test_pdf_extraction_with_pypdf(self):
        """PDF извлечение собирает текст из страниц (через mock pypdf модуля)."""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Содержимое страницы"

        mock_reader = MagicMock()
        mock_reader.pages = [mock_page]

        mock_pypdf = MagicMock()
        mock_pypdf.PdfReader.return_value = mock_reader

        import sys
        # Временно подставляем mock-модуль pypdf
        original = sys.modules.get("pypdf")
        sys.modules["pypdf"] = mock_pypdf
        try:
            # Вызываем extract_text — он внутри делает import pypdf
            result = extract_text(b"pdf_data", "application/pdf", "doc.pdf")
        finally:
            if original is not None:
                sys.modules["pypdf"] = original
            else:
                sys.modules.pop("pypdf", None)

        assert "Содержимое страницы" in result

    def test_pdf_corrupt_file(self):
        """Повреждённый PDF обрабатывается gracefully."""
        result = extract_text(b"not a pdf at all", "application/pdf", "corrupt.pdf")
        # Должен вернуть сообщение об ошибке или fallback, не упасть
        assert isinstance(result, str)
        assert "ошибка" in result.lower() or "pip install" in result.lower()


# -------------------------------------------------------------------------
# Извлечение из Excel
# -------------------------------------------------------------------------


class TestExtractExcel:

    def test_excel_missing_library(self):
        """Без openpyxl возвращается сообщение об установке."""
        import builtins
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "openpyxl":
                raise ImportError("No module named 'openpyxl'")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = _extract_excel(b"fake xlsx", "data.xlsx")

        assert "pip install openpyxl" in result
        assert "data.xlsx" in result

    def test_excel_corrupt_file(self):
        """Повреждённый Excel обрабатывается gracefully."""
        result = extract_text(
            b"not excel data",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "corrupt.xlsx",
        )
        assert isinstance(result, str)
        assert "ошибка" in result.lower() or "pip install" in result.lower()

    def test_excel_vnd_ms_excel_routed(self):
        """application/vnd.ms-excel маршрутизируется на _extract_excel."""
        # Проверяем маршрутизацию — не содержимое
        result = extract_text(
            b"old excel format",
            "application/vnd.ms-excel",
            "old.xls",
        )
        # Или ошибка чтения, или сообщение об установке — но не "не поддерживается"
        assert "не поддерживается" not in result


# -------------------------------------------------------------------------
# Извлечение из Word (.docx)
# -------------------------------------------------------------------------


class TestExtractDocx:

    def test_docx_missing_library(self):
        """Без python-docx возвращается сообщение об установке."""
        import builtins
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "docx":
                raise ImportError("No module named 'docx'")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=mock_import):
            result = _extract_docx(b"fake docx", "document.docx")

        assert "pip install python-docx" in result
        assert "document.docx" in result

    def test_docx_mime_type_routed(self):
        """DOCX MIME-тип маршрутизируется на _extract_docx."""
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        result = extract_text(b"not docx", mime, "document.docx")
        # Не "не поддерживается" — маршрутизация правильная
        assert "не поддерживается" not in result

    def test_docx_corrupt_file(self):
        """Повреждённый DOCX обрабатывается gracefully."""
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        result = extract_text(b"corrupt data", mime, "broken.docx")
        assert isinstance(result, str)
        assert "ошибка" in result.lower() or "pip install" in result.lower()


# -------------------------------------------------------------------------
# Специальные случаи
# -------------------------------------------------------------------------


class TestEdgeCases:

    def test_zero_byte_file(self):
        """Файл нулевого размера."""
        result = extract_text(b"", "text/plain", "empty.txt")
        assert result == ""

    def test_binary_as_text(self):
        """Бинарные данные как text/* — декодирование с фолбеком."""
        data = bytes(range(256))
        result = extract_text(data, "text/plain", "binary.txt")
        # Latin-1 фолбек примет все байты
        assert isinstance(result, str)

    def test_very_long_filename(self):
        """Длинное имя файла в placeholder."""
        long_name = "a" * 500 + ".pdf"
        result = extract_text(b"data", "application/zip", long_name)
        assert long_name in result

    def test_special_chars_in_filename(self):
        """Спецсимволы в имени файла."""
        name = "файл (копия) [2025].txt"
        result = extract_text(b"data", "text/plain", name)
        assert isinstance(result, str)

    def test_max_chars_constant(self):
        """MAX_EXTRACTED_CHARS имеет разумное значение."""
        assert MAX_EXTRACTED_CHARS == 50_000
        assert MAX_EXTRACTED_CHARS > 0

    def test_plain_text_truncation_at_limit(self):
        """Текстовый файл обрезается до MAX_EXTRACTED_CHARS."""
        data = ("A" * (MAX_EXTRACTED_CHARS + 5000)).encode("utf-8")
        result = _extract_plain_text(data, "huge.txt")
        assert "обрезан" in result
        assert f"{MAX_EXTRACTED_CHARS} символов" in result

    def test_multiple_text_types(self):
        """Различные text/* подтипы маршрутизируются корректно."""
        for mime in ["text/plain", "text/csv", "text/html", "text/xml", "text/markdown"]:
            result = extract_text(b"content", mime, "file.txt")
            assert "не поддерживается" not in result

    def test_none_data_handled(self):
        """None вместо bytes обрабатывается через общий exception handler."""
        result = extract_text(None, "text/plain", "null.txt")
        assert "Ошибка" in result
