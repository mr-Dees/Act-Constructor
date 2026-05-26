import pytest
from datetime import date
from pydantic import ValidationError
from app.domains.acts.schemas.act_metadata import AuditTeamMember, ActCreate


def _curator() -> AuditTeamMember:
    return AuditTeamMember(role='Куратор', full_name='К. К.', position='Аудитор', username='100')


def _leader() -> AuditTeamMember:
    return AuditTeamMember(role='Руководитель', full_name='Р. Р.', position='Старший аудитор', username='200')


def _appendix(text: str = 'В соответствии с приложением №3 к распоряжению УВА от 2026-01-01 № 12/34') -> AuditTeamMember:
    return AuditTeamMember(role='AppendixRef', full_name=text, position='-', username='-')


def test_appendix_ref_role_allowed():
    m = _appendix()
    assert m.role == 'AppendixRef'


def test_appendix_ref_does_not_count_as_participant():
    # Куратор + Руководитель + Appendix → валидно (без обычных Участников)
    ActCreate(
        km_number='КМ-99-94751',
        inspection_name='Test',
        city='Москва',
        order_number='123',
        order_date=date(2026, 1, 1),
        audit_team=[_curator(), _leader(), _appendix()],
        inspection_start_date=date(2026, 1, 2),
        inspection_end_date=date(2026, 1, 3),
    )


def test_appendix_ref_does_not_substitute_curator():
    with pytest.raises(ValidationError):
        ActCreate(
            km_number='КМ-99-94751',
            inspection_name='Test',
            city='Москва',
            order_number='123',
            order_date=date(2026, 1, 1),
            audit_team=[_leader(), _appendix()],
            inspection_start_date=date(2026, 1, 2),
            inspection_end_date=date(2026, 1, 3),
        )
