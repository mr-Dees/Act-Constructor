"""Тесты настроек домена ЦК Клиентский опыт: working_set_cap."""

from app.domains.ck_client_exp.settings import CkClientExpSettings


def test_working_set_cap_default():
    """По умолчанию рабочий набор ограничен 1000 записями."""
    s = CkClientExpSettings()
    assert s.working_set_cap == 1000


def test_working_set_cap_override():
    """Значение working_set_cap переопределяется явно."""
    s = CkClientExpSettings(working_set_cap=2500)
    assert s.working_set_cap == 2500
