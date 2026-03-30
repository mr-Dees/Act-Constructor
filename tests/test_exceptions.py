"""Тесты для исключений: базовый AppError и доменные исключения."""

import pytest

from app.core.exceptions import AppError
from app.domains.acts.exceptions import (
    AccessDeniedError,
    ActLockError,
    ActNotFoundError,
    ActValidationError,
    InvoiceError,
    KmConflictError,
    ManagementRoleRequiredError,
    UnsupportedFormatError,
)


class TestAppError:

    def test_message_stored(self):
        err = AppError("test message")
        assert err.message == "test message"
        assert str(err) == "test message"

    def test_default_status_code(self):
        assert AppError.status_code == 500

    def test_to_detail(self):
        err = AppError("oops")
        assert err.to_detail() == {"detail": "oops"}


class TestStatusCodes:

    @pytest.mark.parametrize("cls,code", [
        (ActNotFoundError, 404),
        (AccessDeniedError, 403),
        (ManagementRoleRequiredError, 403),
        (ActLockError, 409),
        (KmConflictError, 409),
        (ActValidationError, 400),
        (UnsupportedFormatError, 400),
        (InvoiceError, 400),
    ])
    def test_status_code(self, cls, code):
        assert cls.status_code == code


class TestActLockError:

    def test_to_detail_with_lock_info(self):
        err = ActLockError(
            "Заблокирован", locked_by="10029384", locked_until="2026-03-25T12:00:00"
        )
        detail = err.to_detail()
        assert detail["detail"] == "Заблокирован"
        assert detail["locked_by"] == "10029384"
        assert detail["locked_until"] == "2026-03-25T12:00:00"

    def test_to_detail_without_lock_info(self):
        err = ActLockError("Нет блокировки")
        detail = err.to_detail()
        assert detail["locked_by"] is None
        assert detail["locked_until"] is None


class TestKmConflictError:

    def test_to_detail(self):
        err = KmConflictError(
            "Конфликт",
            km_number="КМ-01-23456",
            current_parts=2,
            next_part=3,
        )
        detail = err.to_detail()
        assert detail["type"] == "km_exists"
        assert detail["km_number"] == "КМ-01-23456"
        assert detail["current_parts"] == 2
        assert detail["next_part"] == 3

    def test_to_detail_defaults(self):
        err = KmConflictError("Конфликт")
        detail = err.to_detail()
        assert detail["km_number"] is None
        assert detail["current_parts"] is None
        assert detail["next_part"] is None

    def test_inherits_app_error(self):
        err = KmConflictError("msg")
        assert isinstance(err, AppError)
