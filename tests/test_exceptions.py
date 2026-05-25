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

    def test_default_code(self):
        assert AppError.code == "app-error"

    def test_to_envelope_minimal(self):
        err = AppError("oops")
        assert err.to_envelope() == {"detail": "oops", "code": "app-error"}

    def test_to_envelope_no_extra_when_empty(self):
        """Envelope не содержит ключа extra, если у исключения нет доп. полей."""
        err = AppError("oops")
        assert "extra" not in err.to_envelope()


class TestCodes:

    @pytest.mark.parametrize("cls,expected_code", [
        (ActNotFoundError, "act-not-found"),
        (AccessDeniedError, "access-denied"),
        (ManagementRoleRequiredError, "act-management-role-required"),
        (ActLockError, "act-locked"),
        (KmConflictError, "km-number-exists"),
        (ActValidationError, "act-validation"),
        (UnsupportedFormatError, "act-unsupported-format"),
        (InvoiceError, "act-invoice-error"),
    ])
    def test_code(self, cls, expected_code):
        assert cls.code == expected_code


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

    def test_to_envelope_with_lock_info(self):
        err = ActLockError(
            "Заблокирован", locked_by="10029384", locked_until="2026-03-25T12:00:00"
        )
        envelope = err.to_envelope()
        assert envelope["detail"] == "Заблокирован"
        assert envelope["code"] == "act-locked"
        assert envelope["extra"]["locked_by"] == "10029384"
        assert envelope["extra"]["locked_until"] == "2026-03-25T12:00:00"

    def test_to_envelope_without_lock_info(self):
        err = ActLockError("Нет блокировки")
        envelope = err.to_envelope()
        # extra всегда присутствует (даже с None-значениями) — ActLockError
        # инициализирует self.extra безусловно.
        assert envelope["extra"]["locked_by"] is None
        assert envelope["extra"]["locked_until"] is None


class TestKmConflictError:

    def test_to_envelope(self):
        err = KmConflictError(
            "Конфликт",
            km_number="КМ-01-23456",
            current_parts=2,
            next_part=3,
        )
        envelope = err.to_envelope()
        assert envelope["code"] == "km-number-exists"
        assert envelope["extra"]["km_number"] == "КМ-01-23456"
        assert envelope["extra"]["current_parts"] == 2
        assert envelope["extra"]["next_part"] == 3

    def test_to_envelope_defaults(self):
        err = KmConflictError("Конфликт")
        envelope = err.to_envelope()
        assert envelope["extra"]["km_number"] is None
        assert envelope["extra"]["current_parts"] is None
        assert envelope["extra"]["next_part"] is None

    def test_inherits_app_error(self):
        err = KmConflictError("msg")
        assert isinstance(err, AppError)
