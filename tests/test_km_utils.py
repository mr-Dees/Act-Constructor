"""Тесты для KMUtils — утилиты КМ-номеров и служебных записок."""

import pytest

from app.domains.acts.utils.km_utils import KMUtils


class TestExtractKmDigits:
    """Тесты extract_km_digits."""

    def test_standard_km_format(self):
        assert KMUtils.extract_km_digits("КМ-01-23456") == 123456

    def test_standard_km_format_2(self):
        assert KMUtils.extract_km_digits("КМ-12-34567") == 1234567

    def test_plain_digits(self):
        assert KMUtils.extract_km_digits("1234567") == 1234567

    def test_digits_with_leading_zero(self):
        assert KMUtils.extract_km_digits("КМ-00-12345") == 12345

    def test_too_few_digits_raises(self):
        with pytest.raises(ValueError, match="ровно 7 цифр"):
            KMUtils.extract_km_digits("КМ-01-234")

    def test_too_many_digits_raises(self):
        with pytest.raises(ValueError, match="ровно 7 цифр"):
            KMUtils.extract_km_digits("КМ-012-345678")

    def test_no_digits_raises(self):
        with pytest.raises(ValueError, match="ровно 7 цифр"):
            KMUtils.extract_km_digits("АБВГД")


class TestExtractServiceNoteSuffix:
    """Тесты extract_service_note_suffix."""

    def test_standard_format(self):
        assert KMUtils.extract_service_note_suffix("ДА-001/2024") == "2024"

    def test_multiple_slashes_takes_last(self):
        assert KMUtils.extract_service_note_suffix("A/B/C") == "C"

    def test_empty_string_returns_none(self):
        assert KMUtils.extract_service_note_suffix("") is None

    def test_none_returns_none(self):
        assert KMUtils.extract_service_note_suffix(None) is None

    def test_no_slash_returns_none(self):
        assert KMUtils.extract_service_note_suffix("ДА-001-2024") is None
