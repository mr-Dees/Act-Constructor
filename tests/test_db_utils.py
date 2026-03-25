"""Тесты для DB утилит — JSON/JSONB и SQL-идентификаторы."""

import pytest

from app.db.utils.json_db_utils import JSONDBUtils
from app.db.utils.sql_utils import quote_ident, validate_sql_identifier


# ── JSONDBUtils.ensure_dict ──


class TestJSONDBUtils:

    def test_dict_returns_same_dict(self):
        d = {"a": 1, "b": 2}
        assert JSONDBUtils.ensure_dict(d) is d

    def test_empty_dict_returns_empty_dict(self):
        assert JSONDBUtils.ensure_dict({}) == {}

    def test_valid_json_string(self):
        assert JSONDBUtils.ensure_dict('{"a": 1}') == {"a": 1}

    def test_nested_json_string(self):
        assert JSONDBUtils.ensure_dict('{"a": {"b": 2}}') == {"a": {"b": 2}}

    def test_invalid_json_string(self):
        assert JSONDBUtils.ensure_dict("not json") is None

    def test_empty_string(self):
        assert JSONDBUtils.ensure_dict("") is None

    def test_none_returns_none(self):
        assert JSONDBUtils.ensure_dict(None) is None

    def test_int_returns_none(self):
        assert JSONDBUtils.ensure_dict(42) is None

    def test_float_returns_none(self):
        assert JSONDBUtils.ensure_dict(3.14) is None

    def test_list_returns_none(self):
        assert JSONDBUtils.ensure_dict([1, 2, 3]) is None

    def test_bool_returns_none(self):
        assert JSONDBUtils.ensure_dict(True) is None

    def test_json_array_string_returns_none(self):
        assert JSONDBUtils.ensure_dict('[1, 2, 3]') is None

    def test_json_number_string_returns_none(self):
        assert JSONDBUtils.ensure_dict('42') is None

    def test_json_string_value_returns_none(self):
        assert JSONDBUtils.ensure_dict('"hello"') is None


# ── validate_sql_identifier ──


class TestValidateSqlIdentifier:

    def test_simple_name(self):
        assert validate_sql_identifier("users") is True

    def test_underscore_prefix(self):
        assert validate_sql_identifier("_private") is True

    def test_name_with_digits(self):
        assert validate_sql_identifier("Table1") is True

    def test_mixed_name(self):
        assert validate_sql_identifier("my_table") is True

    def test_starts_with_digit(self):
        assert validate_sql_identifier("1table") is False

    def test_hyphen(self):
        assert validate_sql_identifier("my-table") is False

    def test_space(self):
        assert validate_sql_identifier("my table") is False

    def test_empty_string(self):
        assert validate_sql_identifier("") is False

    def test_dot(self):
        assert validate_sql_identifier("foo.bar") is False

    def test_keyword_is_valid(self):
        assert validate_sql_identifier("SELECT") is True


# ── quote_ident ──


class TestQuoteIdent:

    def test_simple_name(self):
        assert quote_ident("users") == '"users"'

    def test_name_with_digits(self):
        assert quote_ident("my_table_123") == '"my_table_123"'

    def test_invalid_raises_value_error(self):
        with pytest.raises(ValueError, match="Небезопасный"):
            quote_ident("1table")

    def test_hyphen_raises(self):
        with pytest.raises(ValueError):
            quote_ident("my-table")

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            quote_ident("")
