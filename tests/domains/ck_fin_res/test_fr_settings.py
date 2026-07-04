"""Тесты настроек домена ЦК Фин.Рез.: working_set_cap."""

from app.domains.ck_fin_res.settings import CkFinResSettings


def test_working_set_cap_default():
    """По умолчанию рабочий набор ограничен 1000 записями."""
    s = CkFinResSettings()
    assert s.working_set_cap == 1000


def test_working_set_cap_override():
    """Значение working_set_cap переопределяется явно."""
    s = CkFinResSettings(working_set_cap=2500)
    assert s.working_set_cap == 2500
